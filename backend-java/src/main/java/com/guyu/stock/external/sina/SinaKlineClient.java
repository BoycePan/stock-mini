package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import com.guyu.stock.common.fetcher.DataSource;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

public class SinaKlineClient {

    public record KLine(String time, double open, double high, double low, double close, long volume) {}
    public record KLineResult(String code, String scale, List<KLine> klines, int count) {}

    private static final String KLINE_URL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    final DataSource source; // package-private: 便于测试 stub 直接可见（避免反射）
    private final Cache<String, KLineResult> minuteCache;

    public SinaKlineClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        // Caffeine 3.1.8（Spring Boot 管理版本）的 Cache 没有 put(K,V,Duration) 重载，
        // 用按 key 的 Expiry 策略实现按 scale 差异化 TTL：5→30s / 15→60s / 30→120s / 60→180s。
        this.minuteCache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfter(new Expiry<String, KLineResult>() {
                    @Override
                    public long expireAfterCreate(String key, KLineResult value, long currentTime) {
                        return ttl(scaleOf(key)).toNanos();
                    }

                    @Override
                    public long expireAfterUpdate(String key, KLineResult value, long currentTime, long currentDuration) {
                        return currentDuration;
                    }

                    @Override
                    public long expireAfterRead(String key, KLineResult value, long currentTime, long currentDuration) {
                        return currentDuration;
                    }
                })
                .build();
    }

    public String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }

    public KLineResult getKLine(String code, String scale, int count) {
        if (count <= 0) count = 100;
        if (!"240".equals(scale)) {
            String key = code + ":" + scale;
            KLineResult cached = minuteCache.getIfPresent(key);
            if (cached != null) return cached;
            KLineResult r = fetch(code, scale, count);
            minuteCache.put(key, r);
            return r;
        }
        return fetch(code, scale, count);
    }

    private KLineResult fetch(String code, String scale, int count) {
        String url = KLINE_URL + "?symbol=" + toSymbol(code) + "&scale=" + scale + "&ma=no&datalen=" + count;
        String body = source.getString(url);
        try {
            JsonNode arr = MAPPER.readTree(body);
            List<KLine> klines = new ArrayList<>();
            for (JsonNode n : arr) {
                klines.add(new KLine(
                        n.get("day").asText(),
                        n.get("open").asDouble(),
                        n.get("high").asDouble(),
                        n.get("low").asDouble(),
                        n.get("close").asDouble(),
                        n.get("volume").asLong()));
            }
            return new KLineResult(code, scale, klines, klines.size());
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("新浪K线 JSON 解析失败", e);
        }
    }

    private static Duration ttl(String scale) {
        return switch (scale) {
            case "5" -> Duration.ofSeconds(30);
            case "15" -> Duration.ofSeconds(60);
            case "30" -> Duration.ofSeconds(120);
            case "60" -> Duration.ofSeconds(180);
            default -> Duration.ofSeconds(60);
        };
    }

    // 缓存 key 形如 "{code}:{scale}"，取冒号后的 scale 段用于 Expiry 计算 TTL
    private static String scaleOf(String key) {
        int i = key.lastIndexOf(':');
        return i >= 0 ? key.substring(i + 1) : "";
    }
}
