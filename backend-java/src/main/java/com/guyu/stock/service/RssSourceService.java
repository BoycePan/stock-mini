package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.RssProperties;
import com.guyu.stock.dao.RssSourceRepository;
import com.guyu.stock.external.rss.RssNewsClient;
import com.guyu.stock.external.rss.RssNewsClient.FeedResult;
import com.guyu.stock.external.rss.RssNewsClient.RssItem;
import com.guyu.stock.model.RssSource;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * RSS 新闻源管理（管理后台 /api/mgr/rss/**）。
 * list/create/update 走 rss_source 表；check 复用 RssNewsClient 试抓（只读，不落 news_feed）。
 */
@Service
public class RssSourceService {

    private final RssSourceRepository rssSourceRepository;
    private final RssNewsClient rssNewsClient;
    private final RssProperties props;

    public RssSourceService(RssSourceRepository rssSourceRepository, RssNewsClient rssNewsClient,
                            RssProperties props) {
        this.rssSourceRepository = rssSourceRepository;
        this.rssNewsClient = rssNewsClient;
        this.props = props;
    }

    public List<Map<String, Object>> list(boolean includeDeleted) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (RssSource s : rssSourceRepository.findAll(includeDeleted)) {
            result.add(toMap(s));
        }
        return result;
    }

    public Map<String, Object> create(String name, String url, boolean viaWorker, boolean enabled) {
        if (name == null || name.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "源名称不能为空");
        if (url == null || url.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "URL 不能为空");
        long id = rssSourceRepository.insert(name.trim(), url.trim(), viaWorker, enabled);
        return rssSourceRepository.findById(id).map(this::toMap)
                .orElseThrow(() -> new BizException(ErrCode.SERVER_ERROR, "新增源失败"));
    }

    public Map<String, Object> update(long id, String name, String url, Boolean viaWorker,
                                      Boolean enabled, Boolean deleted) {
        int rows = rssSourceRepository.update(id, name, url, viaWorker, enabled, deleted);
        if (rows == 0) throw new BizException(ErrCode.NOT_FOUND, "数据源不存在: id=" + id);
        return rssSourceRepository.findById(id).map(this::toMap)
                .orElseThrow(() -> new BizException(ErrCode.NOT_FOUND, "数据源不存在: id=" + id));
    }

    /**
     * 试抓（可达性 + 预览）。id 与 url 二选一；只读，不落 news_feed；
     * saveStatus=true 且传了 id 时回写 rss_source 的 last_* 状态。
     */
    public Map<String, Object> check(Long id, String url, Boolean viaWorker, Integer maxItems, boolean saveStatus) {
        String targetUrl;
        boolean targetViaWorker;
        if (id != null && id > 0) {
            RssSource s = rssSourceRepository.findById(id)
                    .orElseThrow(() -> new BizException(ErrCode.NOT_FOUND, "数据源不存在: id=" + id));
            targetUrl = s.url();
            targetViaWorker = s.viaWorker();
        } else if (url != null && !url.isBlank()) {
            targetUrl = url.trim();
            targetViaWorker = Boolean.TRUE.equals(viaWorker);
        } else {
            throw new BizException(ErrCode.INVALID_PARAM, "id 与 url 至少传一个");
        }
        int max = (maxItems == null || maxItems <= 0) ? props.getMaxItemsPerFeed() : maxItems;

        long start = System.currentTimeMillis();
        boolean reachable;
        String status;
        String error = null;
        int itemCount = 0;
        String feedTitle = null;
        List<Map<String, Object>> items = new ArrayList<>();
        try {
            if (targetViaWorker && !rssNewsClient.hasWorker()) {
                throw new BizException(ErrCode.INVALID_PARAM, "该源标记走 Worker，但未配置 Worker 通道（app.rss.worker-base）");
            }
            FeedResult fetched = rssNewsClient.fetchWithTitle(targetUrl, targetViaWorker, max);
            feedTitle = fetched.title() == null || fetched.title().isBlank() ? null : fetched.title();
            itemCount = fetched.items().size();
            for (RssItem it : fetched.items()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("title", it.title());
                m.put("link", it.link());
                m.put("publishedAt", it.publishedAt());
                items.add(m);
            }
            reachable = true;
            status = "ok";
        } catch (Exception e) {
            reachable = false;
            status = "fail";
            error = e.getMessage();
        }
        long elapsed = System.currentTimeMillis() - start;

        if (saveStatus && id != null && id > 0) {
            rssSourceRepository.updateStatus(id, status, error, Timestamp.from(Instant.now()), itemCount);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("reachable", reachable);
        result.put("status", status);
        result.put("elapsedMs", elapsed);
        result.put("itemCount", itemCount);
        result.put("error", error);
        result.put("feedTitle", feedTitle);
        result.put("items", items);
        return result;
    }

    private Map<String, Object> toMap(RssSource s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.id());
        m.put("name", s.name());
        m.put("url", s.url());
        m.put("viaWorker", s.viaWorker());
        m.put("enabled", s.enabled());
        m.put("deleted", s.deleted());
        m.put("lastStatus", s.lastStatus());
        m.put("lastError", s.lastError());
        m.put("lastFetchAt", s.lastFetchAt() == null ? null : s.lastFetchAt().toInstant().toString());
        m.put("lastItemCount", s.lastItemCount());
        return m;
    }
}
