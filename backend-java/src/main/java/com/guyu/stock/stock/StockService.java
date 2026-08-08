package com.guyu.stock.stock;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class StockService {

    private final StockKlineRepository klineRepository;
    private final StockInfoRepository infoRepository;

    public StockService(StockKlineRepository klineRepository, StockInfoRepository infoRepository) {
        this.klineRepository = klineRepository;
        this.infoRepository = infoRepository;
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

    /** 对齐 Go dbKlinesToResult：库内 DESC → API 升序；返回 {code, scale, klines, count} */
    public Map<String, Object> getKlines(String code, String scale, int count) {
        if (count <= 0) count = 100;
        String dbScale = scaleToDb(scale);

        List<Map<String, Object>> klines = new ArrayList<>();
        List<StockKline> rows = klineRepository.queryByCode(code, dbScale, count);
        // 查询结果 trade_date DESC，反转成升序
        for (int i = rows.size() - 1; i >= 0; i--) {
            StockKline k = rows.get(i);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("time", k.tradeDate().toString());          // "2026-08-06"
            item.put("open", k.open());
            item.put("high", k.high());
            item.put("low", k.low());
            item.put("close", k.close());
            item.put("volume", k.volume());
            klines.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("scale", scale);
        result.put("klines", klines);
        result.put("count", klines.size());
        return result;
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
