package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.model.NewsRow;
import com.guyu.stock.service.AsyncNewsSaver;
import com.guyu.stock.util.NewsUpdateUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 新浪通用新闻 feed 定时拉取。
 * <p>替代原 /news/feed 接口的实时抓取：每 5 分钟拉一次新浪滚动新闻（关键词/条数走 app.sina.feed-* 配置），
 * 经 AsyncNewsSaver 复用 news_feed 表（ON CONFLICT DO NOTHING 按 stock_code+title+published_at 去重）。
 * /news/feed 接口只查库，不再直接打新浪。</p>
 */
@Component
public class SinaFeedScheduler implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SinaFeedScheduler.class);

    private final AppProperties appProperties;
    private final SinaNewsClient sinaNewsClient;
    private final AsyncNewsSaver asyncNewsSaver;
    /** 防重入：拉取慢于 5 分钟时跳过重叠执行 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    public SinaFeedScheduler(AppProperties appProperties, SinaNewsClient sinaNewsClient,
                             AsyncNewsSaver asyncNewsSaver) {
        this.appProperties = appProperties;
        this.sinaNewsClient = sinaNewsClient;
        this.asyncNewsSaver = asyncNewsSaver;
    }

    /** 每 5 分钟拉一次新浪通用新闻并异步落库 */
    @Scheduled(cron = "0 */5 * * * *")
    public void fetchFeed() {
        AppProperties.Sina cfg = appProperties.getSina();
        if (!cfg.isFeedEnabled()) return;
        if (!running.compareAndSet(false, true)) {
            log.debug("[sina-feed] 上一轮尚未结束，跳过本次");
            return;
        }
        try {
            List<SinaNewsClient.NewsItem> items = sinaNewsClient.fetchFeedNews(cfg.getFeedKeyword(), cfg.getFeedCount());
            List<NewsRow> rows = items.stream()
                    .map(it -> new NewsRow(null, "", it.title(), it.summary(), it.url(), it.source(), it.time()))
                    .toList();
            asyncNewsSaver.save(rows);
            log.info("[sina-feed] 关键词 [{}] 解析 {} 条 → 异步落库", cfg.getFeedKeyword(), rows.size());
        } catch (Exception e) {
            log.error("[sina-feed] 拉取失败: {}", e.getMessage());
        } finally {
            running.set(false);

            // 更新最新拉取时间
            NewsUpdateUtil.updateTime();
        }
    }

    /** 启动即拉一次，避免冷启动后 feed 空窗等待首个 5 分钟周期（受 feed-enabled 开关保护） */
    @Override
    public void run(ApplicationArguments args) {
        fetchFeed();
    }
}
