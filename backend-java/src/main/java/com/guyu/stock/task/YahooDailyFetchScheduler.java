package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.YahooIndexService;
import com.guyu.stock.service.YahooSectorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 每天 6:00 自动拉取雅虎全球资产日线并同步元数据（指数 + 板块 ETF）。
 * 6:00（北京时间）时美股/欧洲/亚太均已收盘，日线为最终值。
 */
@Component
public class YahooDailyFetchScheduler {

    private static final Logger log = LoggerFactory.getLogger(YahooDailyFetchScheduler.class);

    private final YahooIndexService yahooIndexService;
    private final YahooSectorService yahooSectorService;
    private final AppProperties appProperties;

    public YahooDailyFetchScheduler(YahooIndexService yahooIndexService, YahooSectorService yahooSectorService,
                                    AppProperties appProperties) {
        this.yahooIndexService = yahooIndexService;
        this.yahooSectorService = yahooSectorService;
        this.appProperties = appProperties;
    }

    @Scheduled(cron = "0 0 6 * * *")
    public void fetchDaily() {
        if (!appProperties.getFetch().isAutoFetch()) {
            log.info("[定时任务] app.fetch.auto-fetch=false，跳过每日雅虎拉取");
            return;
        }
        try {
            yahooIndexService.syncIndexInfo();
            yahooIndexService.fetchIndices("1y");
        } catch (Exception e) {
            log.error("[定时任务] 指数拉取失败", e);
        }
        // 板块拉取：独立 try/catch，指数失败不影响板块
        try {
            yahooSectorService.syncSectorInfo();
            yahooSectorService.fetchSectors("1y");
        } catch (Exception e) {
            log.error("[定时任务] 板块拉取失败", e);
        }
    }
}
