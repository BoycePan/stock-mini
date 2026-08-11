package com.guyu.stock.common.fetcher;

import com.google.common.util.concurrent.RateLimiter;
import com.guyu.stock.common.util.SleepUtil;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.StringJoiner;

public class DataSource {

    private final String name;
    private final double rateLimitSeconds;
    private final int maxRetries;
    private final String userAgent;
    private final String referer;
    private final int connectTimeoutMs;
    private final int readTimeoutMs;
    private final RateLimiter limiter;

    public DataSource(String name, double rateLimitSeconds, int maxRetries, String userAgent, String referer) {
        this(name, rateLimitSeconds, maxRetries, userAgent, referer, 30);
    }

    public DataSource(String name, double rateLimitSeconds, int maxRetries, String userAgent, String referer, int timeoutSeconds) {
        this.name = name;
        this.rateLimitSeconds = rateLimitSeconds;
        this.maxRetries = Math.max(0, maxRetries);
        this.userAgent = userAgent;
        this.referer = referer;
        int timeoutMs = timeoutSeconds <= 0 ? 30_000 : timeoutSeconds * 1000;
        this.connectTimeoutMs = timeoutMs;
        this.readTimeoutMs = timeoutMs;
        this.limiter = rateLimitSeconds > 0 ? RateLimiter.create(1.0 / rateLimitSeconds) : null;
    }

    public static DataSource sina() {
        return new DataSource("sina", 1.0, 3,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "https://finance.sina.com.cn");
    }

    public String name() { return name; }
    public int maxRetries() { return maxRetries; }

    public byte[] getBytes(String url) {
        RuntimeException last = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                SleepUtil.sleep(500L * (1L << (attempt - 1))); // 指数退避 500ms→1s→2s
            }
            if (limiter != null) limiter.acquire();
            try {
                return doGet(url);
            } catch (RuntimeException e) {
                last = e;
            }
        }
        throw new FetchException("fetcher[" + name + "] 重试" + maxRetries + "次后仍然失败", last);
    }

    public String getString(String url) {
        return new String(getBytes(url), StandardCharsets.UTF_8);
    }

    public String getStringDecoded(String url, String charset) {
        return Encoders.decode(getBytes(url), charset);
    }

    public String postForm(String url, Map<String, String> form) {
        if (limiter != null) limiter.acquire();
        try {
            StringJoiner sj = new StringJoiner("&");
            for (Map.Entry<String, String> e : form.entrySet()) {
                sj.add(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue() == null ? "" : e.getValue(), StandardCharsets.UTF_8));
            }
            byte[] body = sj.toString().getBytes(StandardCharsets.UTF_8);
            HttpURLConnection conn = open(url);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) { os.write(body); }
            return new String(readAll(conn), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new FetchException("POST 失败: " + url, e);
        }
    }

    private byte[] doGet(String url) {
        try {
            HttpURLConnection conn = open(url);
            return readAll(conn);
        } catch (IOException e) {
            throw new FetchException("请求失败: " + url, e);
        }
    }

    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(connectTimeoutMs);
        conn.setReadTimeout(readTimeoutMs);
        conn.setInstanceFollowRedirects(true);
        if (userAgent != null && !userAgent.isBlank()) conn.setRequestProperty("User-Agent", userAgent);
        if (referer != null && !referer.isBlank()) conn.setRequestProperty("Referer", referer);
        return conn;
    }

    private byte[] readAll(HttpURLConnection conn) throws IOException {
        try (InputStream is = conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
            if (is == null) return new byte[0];
            return is.readAllBytes();
        } finally {
            conn.disconnect();
        }
    }
}
