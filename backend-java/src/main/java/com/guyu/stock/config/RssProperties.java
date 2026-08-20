package com.guyu.stock.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * RSS 定时拉取运行参数（app.rss 段）。
 * 注意：源列表不在这里——源配置走数据库 rss_source 表（RssNewsScheduler 每分钟查询）。
 * 本类只放与"源"无关的运行参数与 Worker 通道凭据。
 */
@Component
@ConfigurationProperties(prefix = "app.rss")
public class RssProperties {
    /** 总开关：false 时定时任务直接跳过（源表仍可正常管理） */
    private boolean enabled = true;
    /** 每个源每轮最多取多少条（实际入库因去重通常远少于此） */
    private int maxItemsPerFeed = 20;
    /** Cloudflare Worker 基址（如 https://proxy.lilaiyun.online）；空=不配 Worker */
    private String workerBase = "";
    /** Worker 鉴权 token（X-Auth-Token 头） */
    private String authToken = "";

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getMaxItemsPerFeed() { return maxItemsPerFeed; }
    public void setMaxItemsPerFeed(int maxItemsPerFeed) { this.maxItemsPerFeed = maxItemsPerFeed; }
    public String getWorkerBase() { return workerBase; }
    public void setWorkerBase(String workerBase) { this.workerBase = workerBase; }
    public String getAuthToken() { return authToken; }
    public void setAuthToken(String authToken) { this.authToken = authToken; }
}
