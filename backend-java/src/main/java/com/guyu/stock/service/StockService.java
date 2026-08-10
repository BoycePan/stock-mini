package com.guyu.stock.service;

import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.model.StockInfo;
import com.guyu.stock.model.StockKline;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class StockService {

    private final StockKlineRepository klineRepository;
    private final StockInfoRepository infoRepository;
    private final SinaKlineClient sinaKlineClient;
    private final ExecutorService backfillExecutor;

    public StockService(StockKlineRepository klineRepository, StockInfoRepository infoRepository,
                        SinaKlineClient sinaKlineClient) {
        this.klineRepository = klineRepository;
        this.infoRepository = infoRepository;
        this.sinaKlineClient = sinaKlineClient;
        // 对齐 Go `go func()`：DB 回填放后台线程，不阻塞响应
        this.backfillExecutor = Executors.newSingleThreadExecutor();
    }

    /** 对齐 Go scaleToDB */
    static String scaleToDb(String scale) {
        return switch (scale) {
            case "240" -> "1d";
            case "1200" -> "1w";
            default -> scale;
        };
    }

    /** 对齐 Go isDBKLine */
    static boolean isDbKline(String scale) {
        return "240".equals(scale) || "1200".equals(scale);
    }

    /** 对齐 Go handler.GetKLine：DB 周期（240/1200）→ 库内 → 未命中回退新浪并异步回填；分钟线 → 直接新浪 */
    public Map<String, Object> getKlines(String code, String scale, int count) {
        if (count <= 0) count = 100;
        if (isDbKline(scale)) {
            Map<String, Object> fromDb = getDbKlines(code, scale, count);
            if (fromDb != null) return fromDb;
            // DB 未命中 → 回退新浪（日线）
            SinaKlineClient.KLineResult sina = sinaKlineClient.getKLine(code, scale, count);
            asyncBackfill(code, scale, sina);
            return result(code, scale, toApiKlines(sina.klines()));
        }
        // 分钟线 → 新浪
        SinaKlineClient.KLineResult sina = sinaKlineClient.getKLine(code, scale, count);
        return result(code, scale, toApiKlines(sina.klines()));
    }

    /** 对齐 Go getDBKLine：库内 DESC → API 升序；返回 {code, scale, klines, count}；无数据返回 null */
    private Map<String, Object> getDbKlines(String code, String scale, int count) {
        String dbScale = scaleToDb(scale);
        List<StockKline> rows = klineRepository.queryByCode(code, dbScale, count);
        if (rows == null || rows.isEmpty()) return null;
        List<Map<String, Object>> klines = new ArrayList<>();
        for (int i = rows.size() - 1; i >= 0; i--) {
            StockKline k = rows.get(i);
            klines.add(klineItem(k.tradeDate().toString(), k.open(), k.high(), k.low(), k.close(), k.volume()));
        }
        return result(code, scale, klines);
    }

    /** 对齐 Go `go func()` 异步回填：提交到后台线程执行，响应立即返回；失败不影响响应（fire-and-forget） */
    private void asyncBackfill(String code, String scale, SinaKlineClient.KLineResult sina) {
        backfillExecutor.submit(() -> {
            try {
                String dbScale = scaleToDb(scale);
                List<StockKline> dbRows = toDbKlines(code, dbScale, sina.klines());
                if (!dbRows.isEmpty()) klineRepository.batchUpsert(dbRows);
            } catch (Exception e) {
                // 对齐 Go go func() 异步回填，失败不影响响应
            }
        });
    }

    /** 对齐 Go dbKlinesToResult 的 kline item：{time, open, high, low, close, volume} */
    private Map<String, Object> klineItem(String time, double open, double high, double low, double close, long volume) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("time", time);
        item.put("open", open);
        item.put("high", high);
        item.put("low", low);
        item.put("close", close);
        item.put("volume", volume);
        return item;
    }

    private List<Map<String, Object>> toApiKlines(List<SinaKlineClient.KLine> klines) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (SinaKlineClient.KLine k : klines) {
            result.add(klineItem(k.time(), k.open(), k.high(), k.low(), k.close(), k.volume()));
        }
        return result;
    }

    /** 对齐 Go sinaKlinesToDB：计算成交额/涨跌幅/振幅 */
    private List<StockKline> toDbKlines(String code, String dbScale, List<SinaKlineClient.KLine> klines) {
        List<StockKline> result = new ArrayList<>();
        double prevClose = 0;
        for (int i = 0; i < klines.size(); i++) {
            SinaKlineClient.KLine k = klines.get(i);
            // Sina 日线 day 字段形如 "2026-08-05"（前 10 位即 ISO 日期）
            LocalDate tradeDate = LocalDate.parse(k.time().substring(0, 10));
            double amount = round2((k.open() + k.high() + k.low() + k.close()) / 4 * k.volume());
            double changeAmt = 0, pctChange = 0, amplitude = 0;
            if (i > 0 && prevClose != 0) {
                changeAmt = round2(k.close() - prevClose);
                pctChange = round2((k.close() - prevClose) / prevClose * 100);
                amplitude = round2((k.high() - k.low()) / prevClose * 100);
            }
            result.add(new StockKline(code, dbScale, tradeDate, k.open(), k.high(), k.low(), k.close(), k.volume(),
                    amount, 0, pctChange, changeAmt, amplitude));
            prevClose = k.close();
        }
        return result;
    }

    private Map<String, Object> result(String code, String scale, List<Map<String, Object>> klines) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("scale", scale);
        result.put("klines", klines);
        result.put("count", klines.size());
        return result;
    }

    /** 对齐 Go round2：float64(int(v*100+0.5))/100，向零截断（负值 -1.235 → -1.23，与 Java Math.round 的 half-up 不同） */
    private static double round2(double v) {
        return (long) (v * 100 + 0.5) / 100.0;
    }

    /** 对齐 Go Search handler：返回 {keyword, count, stocks} */
    public Map<String, Object> search(String q, int limit) {
        if (limit <= 0 || limit > 100) limit = 20;
        List<StockInfo> infos = infoRepository.search(q, limit);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("keyword", q);
        result.put("count", infos.size());
        result.put("stocks", infos);
        return result;
    }
}
