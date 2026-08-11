package com.guyu.stock.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.external.yahoo.YahooIndices;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.StockInfo;
import com.guyu.stock.model.StockKline;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 雅虎全球指数服务：拉取落库 stock_kline（type='index'）、元数据登记 stock_info、以及查询接口。
 * 查询走 Caffeine 缓存（sidecar 侧另有 60s 缓存），避免高频请求触发雅虎限流。
 */
@Service
public class YahooIndexService {

    private static final Logger log = LoggerFactory.getLogger(YahooIndexService.class);

    private final YahooKlineClient yahooKlineClient;
    private final StockKlineRepository klineRepository;
    private final StockInfoRepository infoRepository;

    // K线 60s 缓存；实时行情 10s 缓存（防高频请求触发雅虎限流）
    private final Cache<String, List<YahooKlineClient.KLine>> klineCache;
    private final Cache<String, YahooKlineClient.Quote> quoteCache;

    public YahooIndexService(YahooKlineClient yahooKlineClient, StockKlineRepository klineRepository,
                             StockInfoRepository infoRepository) {
        this.yahooKlineClient = yahooKlineClient;
        this.klineRepository = klineRepository;
        this.infoRepository = infoRepository;
        this.klineCache = Caffeine.newBuilder().expireAfterWrite(Duration.ofSeconds(60)).maximumSize(200).build();
        this.quoteCache = Caffeine.newBuilder().expireAfterWrite(Duration.ofSeconds(10)).maximumSize(200).build();
    }

    /** 拉全部指数（串行 + 300ms 间隔），返回成功落库的指数个数 */
    public int fetchIndices(String range) {
        int ok = 0;
        for (YahooIndices.Symbol s : YahooIndices.INDICES) {
            try {
                int n = fetchIndex(s.code(), range);
                if (n > 0) ok++;
                log.info("[yahoo-index] {} {} 落库 {} 行", s.code(), s.name(), n);
            } catch (Exception e) {
                log.warn("[yahoo-index] {} {} 拉取失败: {}", s.code(), s.name(), e.getMessage());
            }
            sleep(300);
        }
        log.info("[yahoo-index] 完成，成功 {} / {}", ok, YahooIndices.INDICES.size());
        return ok;
    }

    /** 把指数元数据登记到 stock_info（type='index'，market 用于前端分组展示） */
    public int syncIndexInfo() {
        List<StockInfo> infos = new ArrayList<>();
        for (YahooIndices.Symbol s : YahooIndices.INDICES) {
            infos.add(new StockInfo(s.code(), s.name(), "index", s.market(), null, null, true, null));
        }
        infoRepository.batchUpsert(infos);
        log.info("[yahoo-index] 指数元数据登记 stock_info 完成，{} 条", infos.size());
        return infos.size();
    }

    /** 指数 K线：DB 有则查库；无则经 sidecar 拉取落库并返回（K线 60s 缓存防限流） */
    public Map<String, Object> getKlines(String code, String range) {
        List<StockKline> dbRows = klineRepository.queryByCode(code, "1d", 300);
        List<Map<String, Object>> klines = null;
        if (!dbRows.isEmpty()) {
            klines = new ArrayList<>();
            for (int i = dbRows.size() - 1; i >= 0; i--) {
                StockKline k = dbRows.get(i);
                klines.add(klineItem(k.tradeDate().toString(), k.open(), k.high(), k.low(), k.close(), k.volume()));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("scale", "1d");
        result.put("klines", klines);
        result.put("count", klines.size());
        return result;
    }

    /** 指数实时行情（透传 sidecar /quote，10s 缓存防限流） */
    public YahooKlineClient.Quote getQuote(String code) {
        return quoteCache.get(code, yahooKlineClient::getQuote);
    }

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

    /** 拉单只指数日线并落库，返回落库行数 */
    public int fetchIndex(String symbol, String range) {
        List<YahooKlineClient.KLine> rows = yahooKlineClient.getKLine(symbol, range, "1d");
        if (rows.isEmpty()) return 0;
        List<StockKline> dbRows = toDbKlines(symbol, rows);
        klineRepository.batchUpsert(dbRows);
        return dbRows.size();
    }

    /** sidecar 的 date 形如 "2026-08-07 00:00"，前 10 位即 ISO 日期；指数无成交额/换手率概念填 0 */
    private List<StockKline> toDbKlines(String code, List<YahooKlineClient.KLine> rows) {
        List<StockKline> result = new ArrayList<>();
        double prevClose = 0;
        for (int i = 0; i < rows.size(); i++) {
            YahooKlineClient.KLine k = rows.get(i);
            LocalDate tradeDate = LocalDate.parse(k.date().substring(0, 10));
            double changeAmt = 0, pctChange = 0, amplitude = 0;
            if (i > 0 && prevClose != 0) {
                changeAmt = round2(k.close() - prevClose);
                pctChange = round2((k.close() - prevClose) / prevClose * 100);
                amplitude = round2((k.high() - k.low()) / prevClose * 100);
            }
            result.add(new StockKline(code, "1d", tradeDate,
                    k.open(), k.high(), k.low(), k.close(), k.volume(),
                    0, 0, pctChange, changeAmt, amplitude, "index"));
            prevClose = k.close();
        }
        return result;
    }

    private static double round2(double v) {
        return (long) (v * 100 + 0.5) / 100.0;
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
