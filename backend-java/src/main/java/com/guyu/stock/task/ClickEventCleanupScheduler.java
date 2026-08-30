package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.TrackRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * click_event 过期数据定时清理：每天 03:30 删除 {@code server_ts} 早于保留期的记录。
 *
 * <p>保留天数走 {@code app.tracking.cleanup-days}（默认 5 天）；总开关
 * {@code app.tracking.cleanup-enabled}（默认 true）关闭后任务直接跳过。
 * 删除在 {@link TrackRepository#deleteBefore} 内分批执行（每批 5000 行），
 * 避免大表一次 DELETE 锁表过久。</p>
 */
@Component
public class ClickEventCleanupScheduler {

    private static final Logger log = LoggerFactory.getLogger(ClickEventCleanupScheduler.class);

    private final TrackRepository trackRepository;
    private final AppProperties appProperties;

    /** 防重入：删除慢于调度周期时跳过重叠执行 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    public ClickEventCleanupScheduler(TrackRepository trackRepository, AppProperties appProperties) {
        this.trackRepository = trackRepository;
        this.appProperties = appProperties;
    }

    /** 每天 03:30（东8区，凌晨低峰）清理过期 click_event */
    @Scheduled(cron = "0 30 3 * * *")
    public void cleanup() {
        AppProperties.Tracking cfg = appProperties.getTracking();
        if (!cfg.isCleanupEnabled()) {
            log.info("[click-event-cleanup] app.tracking.cleanup-enabled=false，跳过清理");
            return;
        }
        if (!running.compareAndSet(false, true)) {
            log.info("[click-event-cleanup] 上一轮清理仍在执行，跳过本次");
            return;
        }
        try {
            int days = Math.max(1, cfg.getCleanupDays());
            LocalDateTime cutoff = LocalDateTime.now().minusDays(days);
            long t0 = System.currentTimeMillis();
            int deleted = trackRepository.deleteBefore(cutoff);
            log.info("[click-event-cleanup] 清理完成：删除 {} 条 server_ts < {} 的记录，耗时 {}ms",
                    deleted, cutoff, System.currentTimeMillis() - t0);
        } catch (Exception e) {
            log.error("[click-event-cleanup] 清理失败", e);
        } finally {
            running.set(false);
        }
    }
}
