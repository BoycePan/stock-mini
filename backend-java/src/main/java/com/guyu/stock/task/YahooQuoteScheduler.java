package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.YahooQuoteService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 指数快照定时刷新：每 30s 批量拉雅虎最新点位覆盖落库 quote_snapshot。
 * 启动时立即刷一次避免空库；刷新失败临时降频 2 分钟防持续撞限流。
 */
@Component
public class YahooQuoteScheduler implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(YahooQuoteScheduler.class);

    private final YahooQuoteService quoteService;
    private final AppProperties appProperties;

    // 429/网络异常降频：期间跳过刷新
    private volatile long skipUntil = 0;

    public YahooQuoteScheduler(YahooQuoteService quoteService, AppProperties appProperties) {
        this.quoteService = quoteService;
        this.appProperties = appProperties;
    }

    @Scheduled(initialDelay = 30000, fixedDelayString = "${app.fetch.snapshot-interval-ms:30000}")
    public void refresh() {
        AppProperties.Fetch cfg = appProperties.getFetch();
        if (!cfg.isSnapshotEnabled()) return;
        if (System.currentTimeMillis() < skipUntil) return;
        try {
            quoteService.refreshSnapshot();
            skipUntil = 0;
        } catch (Exception e) {
            log.warn("[quote-snapshot] 刷新失败: {}，临时降频 120s", e.getMessage());
            skipUntil = System.currentTimeMillis() + 120_000;
        }
    }

    @Override
    public void run(ApplicationArguments args) {
        // 启动立即刷一次，避免冷启动空库；失败则由 30s 后的 @Scheduled 自动补刷
        if (appProperties.getFetch().isSnapshotEnabled()) {
            try {
                quoteService.refreshSnapshot();
                skipUntil = 0;
                log.info("[quote-snapshot] 启动立即刷新完成");
            } catch (Exception e) {
                log.warn("[quote-snapshot] 启动刷新失败（30s 后自动补刷）: {}", e.getMessage());
            }
        }
    }
}
