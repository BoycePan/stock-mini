package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.WxAdService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 微信 access_token 定时刷新：每 20 分钟为各端（source）刷新一次并落库 wx_access_token。
 *
 * <p>微信 token 有效期 7200s（2h），每 20 分钟刷一次远早于过期，保证
 * {@code PullWxAdDataTask} 任何时刻从表中读到的都是新鲜 token。
 * 单端失败独立 try/catch，不影响其他端；总开关 {@code app.wechat.ad.token-refresh-enabled}。</p>
 */
@Component
public class RefreshWxAccessTokenTask {

    private static final Logger log = LoggerFactory.getLogger(RefreshWxAccessTokenTask.class);

    private final WxAdService wxAdService;
    private final AppProperties appProperties;

    public RefreshWxAccessTokenTask(WxAdService wxAdService, AppProperties appProperties) {
        this.wxAdService = wxAdService;
        this.appProperties = appProperties;
    }

    /** 每 20 分钟刷新一次（东8区） */
    @Scheduled(cron = "0 */20 * * * *", zone = "Asia/Shanghai")
    public void refresh() {
        AppProperties.Wechat.Ad cfg = appProperties.getWechat().getAd();
        if (!cfg.isTokenRefreshEnabled()) {
            log.info("[wx-ad] app.wechat.ad.token-refresh-enabled=false，跳过 token 刷新");
            return;
        }
        Map<String, AppProperties.Wechat.App> apps = appProperties.getWechat().getApps();
        for (String source : apps.keySet()) {
            try {
                wxAdService.refreshToken(source);
            } catch (Exception e) {
                log.error("[wx-ad] 刷新 {} 的 access_token 失败: {}", source, e.getMessage());
            }
        }
    }
}
