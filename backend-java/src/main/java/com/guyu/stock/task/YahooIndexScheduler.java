package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.YahooIndexService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 每天 6:00 自动拉取雅虎全球主要指数日线并同步元数据。
 * 6:00（北京时间）时美股/欧洲/亚太均已收盘，指数日线为最终值。
 */
@Component
public class YahooIndexScheduler {

    private static final Logger log = LoggerFactory.getLogger(YahooIndexScheduler.class);

    private final YahooIndexService yahooIndexService;
    private final AppProperties appProperties;

    public YahooIndexScheduler(YahooIndexService yahooIndexService, AppProperties appProperties) {
        this.yahooIndexService = yahooIndexService;
        this.appProperties = appProperties;
    }

    @Scheduled(cron = "0 0 6 * * *")
    public void fetchIndicesDaily() {
        if (!appProperties.getFetch().isAutoFetch()) {
            log.info("[定时任务] app.fetch.auto-fetch=false，跳过指数拉取");
            return;
        }
        try {
            yahooIndexService.syncIndexInfo();
            yahooIndexService.fetchIndices("1y");
        } catch (Exception e) {
            log.error("[定时任务] 指数拉取失败", e);
        }
    }
}
