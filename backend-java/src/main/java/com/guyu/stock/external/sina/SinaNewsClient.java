package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.common.fetcher.Encoders;
import com.guyu.stock.common.util.StockCodeUtil;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 新浪新闻
 */
public class SinaNewsClient {

    public record NewsItem(String title, String summary, String url, String time, String source) {}

    private static final String STOCK_NEWS_URL = "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=%s&Page=%d";
    private static final String FEED_URL = "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=%s&num=%d&page=1&r=%d&callback=jsonp";
    private static final Pattern STOCK_NEWS_PATTERN = Pattern.compile(
            "(\\d{4}-\\d{2}-\\d{2})&nbsp;(\\d{2}:\\d{2})&nbsp;&nbsp;<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>([^<]+)</a>");
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            .withZone(ZoneId.of("Asia/Shanghai"));
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;
    private final Cache<String, List<NewsItem>> stockNewsCache;
    private final Cache<String, List<NewsItem>> feedCache;

    public SinaNewsClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        // Caffeine 3.x 的 Cache 没有 put(K,V,Duration) 重载，用 expireAfterWrite 实现固定 TTL：
        // 个股新闻 60s / feed 新闻 30s，与 Go 侧 TTL 语义一致。
        this.stockNewsCache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfterWrite(Duration.ofSeconds(60))
                .build();
        this.feedCache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfterWrite(Duration.ofSeconds(30))
                .build();
    }

    public List<NewsItem> fetchStockNews(String code, int page) {
        if (page <= 0) page = 1;
        String key = "stock:" + code + ":" + page;
        List<NewsItem> cached = stockNewsCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(STOCK_NEWS_URL, StockCodeUtil.toSymbol(code), page);
        byte[] raw = source.getBytes(url);
        String html = Encoders.decode(raw, "gb2312");
        List<NewsItem> items = parseStockNews(html);
        stockNewsCache.put(key, items);
        return items;
    }

    public List<NewsItem> fetchFeedNews(String keyword, int count) {
        if (count <= 0) count = 20;
        String key = "feed:" + keyword + ":" + count;
        List<NewsItem> cached = feedCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(FEED_URL, keyword, count, Instant.now().toEpochMilli());
        byte[] raw = source.getBytes(url);
        byte[] json = Encoders.stripJsonp(raw);
        List<NewsItem> items = parseFeed(json);
        feedCache.put(key, items);
        return items;
    }

    private List<NewsItem> parseStockNews(String html) {
        List<NewsItem> items = new ArrayList<>();
        Matcher m = STOCK_NEWS_PATTERN.matcher(html);
        while (m.find()) {
            items.add(new NewsItem(m.group(4).trim(), "", m.group(3), m.group(1) + " " + m.group(2), "新浪"));
        }
        return items;
    }

    private List<NewsItem> parseFeed(byte[] json) {
        List<NewsItem> items = new ArrayList<>();
        try {
            JsonNode root = MAPPER.readTree(json);
            JsonNode data = root.path("result").path("data");
            for (JsonNode n : data) {
                String source = n.path("media_name").asText("");
                if (source.isEmpty()) source = "新浪财经";
                items.add(new NewsItem(
                        n.path("title").asText(""),
                        n.path("intro").asText(""),
                        n.path("url").asText(""),
                        fmtTime(n.path("ctime").asLong(0)),
                        source));
            }
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("新闻feed JSON解析失败", e);
        }
        return items;
    }

    private static String fmtTime(long epochSecond) {
        return epochSecond <= 0 ? "" : TIME_FMT.format(Instant.ofEpochSecond(epochSecond));
    }
}
