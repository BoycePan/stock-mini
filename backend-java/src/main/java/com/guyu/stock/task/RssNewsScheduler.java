package com.guyu.stock.task;

import com.guyu.stock.config.RssProperties;
import com.guyu.stock.dao.RssSourceRepository;
import com.guyu.stock.external.rss.RssNewsClient;
import com.guyu.stock.external.rss.RssNewsClient.RssItem;
import com.guyu.stock.model.NewsRow;
import com.guyu.stock.model.RssSource;
import com.guyu.stock.service.AsyncNewsSaver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * RSS 新闻定时拉取。
 * <p>源配置走数据库：每分钟从 rss_source 表读取 enabled=true 的源（增删改源无需改配置/重启）；
 * 运行参数（总开关/每源条数/Worker 凭据）走 app.rss 配置。</p>
 * <p>海外源（via_worker=true）经 Cloudflare Worker 转发拉取；拉到的新闻复用现有管线
 * （AsyncNewsSaver → news_feed，ON CONFLICT DO NOTHING 按 stock_code+title+published_at 去重）。</p>
 */
@Component
public class RssNewsScheduler implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RssNewsScheduler.class);

    /** 默认源种子：仅当 rss_source 表为空时写入（幂等），之后以数据库为准、不会被覆盖 */
    private static final List<RssSource> DEFAULT_SOURCES = List.of(
            new RssSource(0, "少数派", "https://sspai.com/feed", false),
            new RssSource(0, "爱范儿", "https://www.ifanr.com/feed", false),
            new RssSource(0, "阮一峰", "https://www.ruanyifeng.com/blog/atom.xml", false),
            new RssSource(0, "CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", false),
            new RssSource(0, "TechCrunch", "https://techcrunch.com/feed/", false),
            new RssSource(0, "Yahoo Finance", "https://finance.yahoo.com/news/rssindex", true),
            new RssSource(0, "BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", true),
            new RssSource(0, "The Verge", "https://www.theverge.com/rss/index.xml", true));

    private final RssProperties props;
    private final RssSourceRepository rssSourceRepository;
    private final RssNewsClient rssNewsClient;
    private final AsyncNewsSaver asyncNewsSaver;
    /** 防重入：拉取慢于 1 分钟时跳过重叠执行 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    public RssNewsScheduler(RssProperties props, RssSourceRepository rssSourceRepository,
                            RssNewsClient rssNewsClient, AsyncNewsSaver asyncNewsSaver) {
        this.props = props;
        this.rssSourceRepository = rssSourceRepository;
        this.rssNewsClient = rssNewsClient;
        this.asyncNewsSaver = asyncNewsSaver;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            seedDefaultSources();
        } catch (Exception e) {
            log.warn("[RSS] 默认源种子失败（请先在生产库执行 scripts/rss_source.sql 建表）: {}", e.getMessage());
        }
        try {
            fetchAll();
        } catch (Exception e) {
            log.error("[RSS] 启动首轮拉取失败: {}", e.getMessage());
        }
    }

    /** 表为空时写入默认源（URL 唯一索引保证幂等） */
    private void seedDefaultSources() {
        if (rssSourceRepository.count() > 0) return;
        log.info("[RSS] rss_source 为空，写入 {} 个默认源（之后以数据库为准）", DEFAULT_SOURCES.size());
        for (RssSource s : DEFAULT_SOURCES) {
            rssSourceRepository.insertIfAbsent(s.name(), s.url(), s.viaWorker());
        }
    }

    /** 每分钟拉取所有启用源 */
    @Scheduled(cron = "0 10/10 * * * *")
    public void fetchAll() {
        if (!props.isEnabled()) return;
        if (!running.compareAndSet(false, true)) {
            log.debug("[RSS] 上一轮尚未结束，跳过本次");
            return;
        }
        try {
            List<RssSource> sources = rssSourceRepository.findEnabled();
            if (sources.isEmpty()) {
                log.debug("[RSS] rss_source 无启用源，跳过");
                return;
            }
            log.info("[RSS] 本轮拉取 {} 个源", sources.size());
            for (RssSource s : sources) {
                try {
                    if (s.viaWorker() && !rssNewsClient.hasWorker()) {
                        log.warn("[RSS] 源 [{}] 标记 via-worker 但未配置 Worker 通道（app.rss.worker-base），跳过", s.name());
                        continue;
                    }
                    List<RssItem> items = rssNewsClient.fetch(s.url(), s.viaWorker(), props.getMaxItemsPerFeed());
                    List<NewsRow> rows = items.stream()
                            .map(it -> new NewsRow(null, "", it.title(), it.summary(), it.link(), s.name(), it.publishedAt()))
                            .toList();
                    asyncNewsSaver.save(rows);
                    log.info("[RSS] 源 [{}] 解析 {} 条 → 异步落库", s.name(), rows.size());
                } catch (Exception e) {
                    log.error("[RSS] 源 [{}] 拉取失败: {}", s.name(), e.getMessage());
                }
            }
        } finally {
            running.set(false);
        }
    }
}
