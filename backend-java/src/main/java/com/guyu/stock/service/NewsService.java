package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.cninfo.Announcement;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.model.NewsRow;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 新闻/公告编排（对齐 Go handler.NewsHandler）。
 * 吸收原 NewsController 的抓取 + 组装，异步存库委托给独立的 AsyncNewsSaver（保留 @Async 跨 bean 语义）。
 */
@Service
public class NewsService {

    private final SinaNewsClient sinaNewsClient;
    private final CninfoClient cninfoClient;
    private final AsyncNewsSaver asyncNewsSaver;

    public NewsService(SinaNewsClient sinaNewsClient, CninfoClient cninfoClient, AsyncNewsSaver asyncNewsSaver) {
        this.sinaNewsClient = sinaNewsClient;
        this.cninfoClient = cninfoClient;
        this.asyncNewsSaver = asyncNewsSaver;
    }

    public Map<String, Object> stockNews(String code, Integer page) {
        if (code == null || code.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        int p = (page == null || page <= 0) ? 1 : page;
        List<SinaNewsClient.NewsItem> items = sinaNewsClient.fetchStockNews(code, p);
        asyncNewsSaver.save(toNewsRows(code, items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("count", items.size());
        result.put("news", items);
        return result;
    }

    public Map<String, Object> feed(String q, Integer count) {
        String keyword = (q == null || q.isBlank()) ? "A股" : q;
        int n = (count == null || count <= 0) ? 20 : Math.min(count, 100);
        List<SinaNewsClient.NewsItem> items = sinaNewsClient.fetchFeedNews(keyword, n);
        asyncNewsSaver.save(toNewsRows("", items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("keyword", keyword);
        result.put("count", items.size());
        result.put("news", items);
        return result;
    }

    public Map<String, Object> announcements(String code, Integer page, Integer size) {
        if (code == null || code.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        int p = (page == null || page <= 0) ? 1 : page;
        int s = (size == null || size <= 0) ? 20 : Math.min(size, 100);
        List<Announcement> items = cninfoClient.fetchAnnouncements(code, p, s);
        asyncNewsSaver.save(toAnnouncementRows(code, items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("page", p);
        result.put("count", items.size());
        result.put("items", items);
        return result;
    }

    // 注意：不能将两个 toRows 重载为同名——List<NewsItem> 与 List<Announcement> 泛型擦除后签名相同，
    // 会触发「名称冲突（erasure clash）」编译错误。故按 Go saveNews 的 switch 语义拆成两个不同方法名。
    private List<NewsRow> toNewsRows(String code, List<SinaNewsClient.NewsItem> items) {
        List<NewsRow> rows = new ArrayList<>();
        for (SinaNewsClient.NewsItem n : items) {
            rows.add(new NewsRow(code, n.title(), n.summary(), n.url(), n.source(), n.time()));
        }
        return rows;
    }

    private List<NewsRow> toAnnouncementRows(String code, List<Announcement> items) {
        List<NewsRow> rows = new ArrayList<>();
        for (Announcement a : items) {
            rows.add(new NewsRow(code, a.title(), "", a.url(), "巨潮资讯", a.time()));
        }
        return rows;
    }
}
