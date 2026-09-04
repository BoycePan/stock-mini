package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.WxAdService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 拉取微信广告数据（流量主汇总）。
 *
 * <p>调度：每天 9:00 之后每 20 分钟一次、18:00 之后不执行——配合微信侧数据生成有延时
 * 的特点，一天内反复拉取并 <b>覆盖</b>当天窗口（{@code wx_ad_daily_stat} 唯一键
 * {@code (target, stat_date, ad_slot)} upsert），直到数据不再变化。</p>
 *
 * <p>拉取窗口：[T-(lookbackDays-1), T]（默认 lookbackDays=3 → 近 3 天），滚动覆盖近期修正。
 * token 从 {@code wx_access_token} 读取（由 {@link RefreshWxAccessTokenTask} 维护）。
 * 单端失败独立 try/catch，不影响其他端；总开关 {@code app.wechat.ad.pull-enabled}。</p>
 */
@Component
public class PullWxAdDataTask {

    private static final Logger log = LoggerFactory.getLogger(PullWxAdDataTask.class);

    private final WxAdService wxAdService;
    private final AppProperties appProperties;

    /** 防重入：拉取慢于 20 分钟周期时跳过重叠执行 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    public PullWxAdDataTask(WxAdService wxAdService, AppProperties appProperties) {
        this.wxAdService = wxAdService;
        this.appProperties = appProperties;
    }

    /** 每天 9~17 点每 20 分钟一次（cron 命中的 9:00 与 18:00 边界由窗口守卫过滤） */
    @Scheduled(cron = "0 */20 9-17 * * *", zone = "Asia/Shanghai")
    public void pull() {
        LocalTime now = LocalTime.now();
        if (!now.isAfter(LocalTime.of(9, 0)) || !now.isBefore(LocalTime.of(18, 0))) {
            return; // 仅在 (9:00, 18:00) 窗口内执行：9 点之后、18 点之前
        }
        AppProperties.Wechat.Ad cfg = appProperties.getWechat().getAd();
        if (!cfg.isPullEnabled()) {
            log.info("[wx-ad] app.wechat.ad.pull-enabled=false，跳过广告数据拉取");
            return;
        }
        if (!running.compareAndSet(false, true)) {
            log.info("[wx-ad] 上一轮拉取仍在执行，跳过本次");
            return;
        }
        try {
            LocalDate to = LocalDate.now();
            LocalDate from = to.minusDays(Math.max(0, cfg.getLookbackDays() - 1));
            LocalDate yesterday = to.minusDays(1);
            Map<String, AppProperties.Wechat.App> apps = appProperties.getWechat().getApps();
            for (Map.Entry<String, AppProperties.Wechat.App> e : apps.entrySet()) {
                String source = e.getKey();
                AppProperties.Wechat.App app = e.getValue();
                if (app == null || app.getAppSecret() == null || app.getAppSecret().isBlank()) {
                    continue; // 未配置 secret 的端跳过；已配置 secret 但未开通流量主的端（如 hangQing-tracker）
                              // 由 WxAdService 识别 base_resp.ret=-1/2009/1807 后内部跳过并记 INFO，不再报错
                }
                try {
                    wxAdService.pullDailyStat(source, from, to);
                } catch (Exception ex) {
                    log.error("[wx-ad] {} 拉取广告数据失败: {}", source, ex.getMessage());
                }
                try {
                    wxAdService.pullDailyVisit(source, yesterday);
                } catch (Exception ex) {
                    log.error("[wx-ad] {} 拉取访问趋势失败: {}", source, ex.getMessage());
                }
            }
        } finally {
            running.set(false);
        }
    }
}
