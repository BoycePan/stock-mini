package com.guyu.stock.external.cninfo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.common.fetcher.FetchException;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class CninfoClient {

    private static final String QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")
            .withZone(ZoneId.of("Asia/Shanghai"));
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;
    private final Cache<String, List<Announcement>> cache;

    public CninfoClient(DataSource source) {
        this(source, 1000);
    }

    public CninfoClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        // Caffeine 3.x 的 Cache 没有 put(K,V,Duration) 重载，用 expireAfterWrite 实现固定 5min TTL，与 Go 侧一致。
        this.cache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfterWrite(Duration.ofMinutes(5))
                .build();
    }

    public List<Announcement> fetchAnnouncements(String code, int page, int pageSize) {
        if (page <= 0) page = 1;
        if (pageSize <= 0) pageSize = 20;
        String key = code + ":" + page + ":" + pageSize;
        List<Announcement> cached = cache.getIfPresent(key);
        if (cached != null) return cached;

        String orgId = marketInfo(code);
        Map<String, String> form = new LinkedHashMap<>();
        form.put("pageNum", String.valueOf(page));
        form.put("pageSize", String.valueOf(pageSize));
        form.put("column", orgId.startsWith("sh") ? "sh" : "sz");
        form.put("tabName", "fulltext");
        form.put("plate", orgId.startsWith("sh") ? "sh" : "sz");
        form.put("stock", code + "," + orgId);
        form.put("searchkey", "");
        form.put("secid", "");
        form.put("category", "");
        form.put("trade", "");
        form.put("seDate", "");

        String body = source.postForm(QUERY_URL, form);
        List<Announcement> items = parse(body);
        cache.put(key, items);
        return items;
    }

    private List<Announcement> parse(String body) {
        List<Announcement> items = new ArrayList<>();
        try {
            JsonNode arr = MAPPER.readTree(body).path("announcements");
            for (JsonNode n : arr) {
                String id = n.path("announcementId").asText("");
                long ts = n.path("announcementTime").asLong(0);
                items.add(new Announcement(id,
                        n.path("announcementTitle").asText(""),
                        ts > 0 ? DATE_FMT.format(Instant.ofEpochMilli(ts)) : "",
                        "http://www.cninfo.com.cn/new/disclosure/detail?announcementId=" + id,
                        "https://static.cninfo.com.cn/" + n.path("adjunctUrl").asText("").replaceFirst("^/", "")));
            }
        } catch (Exception e) {
            throw new FetchException("巨潮公告JSON解析失败", e);
        }
        return items;
    }

    /** 返回 orgId；6 → "gssh0"+code，其他 → "gssz0"+code */
    static String marketInfo(String code) {
        if (code == null || code.isEmpty()) return "gssh0";
        char first = code.charAt(0);
        return first == '6' ? "gssh0" + code : "gssz0" + code;
    }
}
