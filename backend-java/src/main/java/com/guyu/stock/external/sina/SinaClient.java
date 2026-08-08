package com.guyu.stock.external.sina;

import com.google.common.util.concurrent.RateLimiter;
import com.guyu.stock.config.AppProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class SinaClient {

    private static final String QUOTE_URL = "http://hq.sinajs.cn/list=";

    private final RestClient restClient;
    private final RateLimiter rateLimiter;
    private final AppProperties.Sina sinaCfg;
    private final int maxRetries;

    public SinaClient(AppProperties.Sina sinaCfg) {
        this.sinaCfg = sinaCfg;
        this.maxRetries = Math.max(0, sinaCfg.getMaxRetries());
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        int timeoutMs = (int) (sinaCfg.getTimeoutSeconds() <= 0 ? 30 : sinaCfg.getTimeoutSeconds()) * 1000;
        factory.setConnectTimeout(timeoutMs);
        factory.setReadTimeout(timeoutMs);
        RestClient.Builder builder = RestClient.builder().requestFactory(factory);
        // null 保护：测试环境下 UA/Referer 可能未配置，RestClient.defaultHeader 不接受 null
        if (sinaCfg.getUserAgent() != null && !sinaCfg.getUserAgent().isBlank()) {
            builder.defaultHeader(HttpHeaders.USER_AGENT, sinaCfg.getUserAgent());
        }
        if (sinaCfg.getReferer() != null && !sinaCfg.getReferer().isBlank()) {
            builder.defaultHeader(HttpHeaders.REFERER, sinaCfg.getReferer());
        }
        this.restClient = builder.build();
        double interval = sinaCfg.getRateLimitSeconds() <= 0 ? 1.0 : sinaCfg.getRateLimitSeconds();
        this.rateLimiter = RateLimiter.create(1.0 / interval);
    }

    /** 6/9 开头 → sh，其他 → sz（对齐 Go toSymbol） */
    public String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }

    /** 拉取行情；每次请求前取限流令牌（对齐 Go Limiter.Wait），失败按指数退避重试（对齐 Go fetcher） */
    public List<Quote> fetchQuotes(List<String> codes) {
        if (codes == null || codes.isEmpty()) return List.of();
        RuntimeException last = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                rateLimiter.acquire();
                List<String> symbols = codes.stream().map(this::toSymbol).toList();
                String url = QUOTE_URL + String.join(",", symbols);
                byte[] raw = restClient.get().uri(url).retrieve().body(byte[].class);
                if (raw == null) return List.of();
                // 保留 GBK 字节：先按 ISO-8859-1 转 String（不丢字节），parseBody 里名称字段再按 GBK 解码
                String body = new String(raw, StandardCharsets.ISO_8859_1);
                return parseBody(body);
            } catch (RuntimeException e) {
                last = e;
                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(500L * (1L << attempt));
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        throw last;
    }

    /** 解析响应文本（body 为 ISO-8859-1 重编码串，名称字段含 GBK 中文）。供测试直接调用。 */
    public List<Quote> parseBody(String body) {
        List<Quote> quotes = new ArrayList<>();
        for (String line : body.split("\n")) {
            line = line.trim();
            if (line.isEmpty() || !line.contains("=")) continue;
            int eq = line.indexOf("=");
            String symbolPart = line.substring(0, eq);
            String code = "";
            int underscore = symbolPart.lastIndexOf('_');
            if (underscore >= 0) {
                String symbol = symbolPart.substring(underscore + 1);
                code = symbol.length() > 2 ? symbol.substring(2) : symbol;
            }
            int quoteStart = line.indexOf('"');
            if (quoteStart < 0) continue;
            String rest = line.substring(quoteStart + 1);
            int quoteEnd = rest.lastIndexOf('"');
            if (quoteEnd < 0) continue;
            String raw = rest.substring(0, quoteEnd);
            Quote q = parseOneQuote(code, raw);
            if (q != null) quotes.add(q);
        }
        return quotes;
    }

    Quote parseOneQuote(String code, String line) {
        String[] fields = line.split(",", -1);
        if (fields.length < 32) return null;
        String name = decodeGbk(fields[0]);
        double prevClose = parseDouble(fields[2]);
        double price = parseDouble(fields[3]);
        double pctChange = prevClose != 0 ? (price - prevClose) / prevClose * 100 : 0;
        return new Quote(
                code,
                name,
                parseDouble(fields[1]),      // open
                prevClose,
                price,
                parseDouble(fields[4]),      // high
                parseDouble(fields[5]),      // low
                parseLong(fields[8]),        // volume
                parseDouble(fields[9]),      // amount
                safeField(fields, 30),       // date
                safeField(fields, 31),       // time
                0,                           // turnover 恒 0（对齐 Go）
                pctChange
        );
    }

    /** 字段0名称是 GBK 中文，其余 ASCII；把 ISO-8859-1 编码字节还原再按 GBK 解码 */
    private String decodeGbk(String s) {
        byte[] bytes = s.getBytes(StandardCharsets.ISO_8859_1);
        return new String(bytes, Charset.forName("GBK"));
    }

    private String safeField(String[] fields, int idx) {
        return idx < fields.length ? fields[idx].trim() : "";
    }

    private double parseDouble(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
