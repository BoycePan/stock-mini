package com.guyu.stock.external.rss;

import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.common.fetcher.FetchException;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;

import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;

/**
 * RSS/Atom 新闻源客户端（Rome 解析）。
 * 兼容 RSS 0.9x/1.0/2.0 与 Atom；日期（GMT/+0000/ISO8601 等）由 Rome 统一解析。
 * 海外源可经 Cloudflare Worker 转发（与 fetch_service.py 同款 URL 重写 + X-Auth-Token 契约）。
 */
public class RssNewsClient {

    /** 单条 RSS 新闻（publishedAt 为东八区 yyyy-MM-dd HH:mm:ss 字符串，供 news_feed 落库） */
    public record RssItem(String title, String summary, String link, String publishedAt) {}

    /** 解析结果：feed 标题（<channel><title>，可能为空串）+ 条目列表（供管理后台自动填源名称） */
    public record FeedResult(String title, List<RssItem> items) {}

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
            .withZone(ZoneId.of("Asia/Shanghai"));

    private final DataSource directSource;
    private final DataSource workerSource;

    public RssNewsClient(DataSource directSource, DataSource workerSource) {
        this.directSource = directSource;
        this.workerSource = workerSource;
    }

    /** 是否配置了 Cloudflare Worker 通道（via-worker 的源可用） */
    public boolean hasWorker() {
        return workerSource != null && workerSource.viaWorker();
    }

    public List<RssItem> fetch(String url, boolean viaWorker, int maxItems) {
        return fetchWithTitle(url, viaWorker, maxItems).items();
    }

    /** 试抓并带 feed 标题（管理后台 check 用，供前端自动填源名称） */
    public FeedResult fetchWithTitle(String url, boolean viaWorker, int maxItems) {
        DataSource source = viaWorker ? workerSource : directSource;
        byte[] raw = source.getBytes(url);
        return parseWithTitle(raw, maxItems);
    }

    /** package-private：解析逻辑独立出来便于单测（RssNewsClientTest 不联网） */
    List<RssItem> parse(byte[] xml, int maxItems) {
        return parseWithTitle(xml, maxItems).items();
    }

    /** 解析并返回 feed 标题 + 条目列表 */
    FeedResult parseWithTitle(byte[] xml, int maxItems) {
        List<RssItem> items = new ArrayList<>();
        String title = "";
        try {
            SyndFeed feed = new SyndFeedInput().build(new XmlReader(new ByteArrayInputStream(xml)));
            title = feed.getTitle() == null ? "" : feed.getTitle().trim();
            for (SyndEntry entry : feed.getEntries()) {
                Date d = entry.getPublishedDate() != null ? entry.getPublishedDate() : entry.getUpdatedDate();
                // 无发布/更新时间则跳过：news_feed 按 stock_code+title+published_at 去重，
                // 若用"当前时间"兜底会导致同一文章每次拉取都因时间戳不同而重复入库。
                if (d == null) continue;
                String summary = entry.getDescription() == null ? "" : entry.getDescription().getValue();
                items.add(new RssItem(
                        entry.getTitle() == null ? "" : entry.getTitle(),
                        summary == null ? "" : summary,
                        entry.getLink() == null ? "" : entry.getLink(),
                        TIME_FMT.format(Instant.ofEpochMilli(d.getTime()))));
            }
        } catch (Exception e) {
            throw new FetchException("RSS/Atom 解析失败，响应前200字节: " + preview(xml), e);
        }
        // 按时间倒序取前 maxItems：防个别源按旧→新排列时截到最旧的一批
        items.sort(Comparator.comparing(RssItem::publishedAt).reversed());
        List<RssItem> limited = items.size() > maxItems ? items.subList(0, maxItems) : items;
        return new FeedResult(title, limited);
    }

    /** 把原始响应转成可读预览（非打印字符用 · 占位），用于定位"返回的不是 XML"的问题 */
    private static String preview(byte[] raw) {
        if (raw == null || raw.length == 0) return "(空响应)";
        int len = Math.min(raw.length, 200);
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) {
            int b = raw[i] & 0xFF;
            if (b >= 32 && b < 127) sb.append((char) b);
            else if (b == '\n' || b == '\r' || b == '\t') sb.append((char) b);
            else sb.append('·');
        }
        return sb.toString();
    }
}
