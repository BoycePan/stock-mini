package com.guyu.stock.task;

import com.guyu.stock.config.CollectorProperties;
import com.guyu.stock.dao.ConceptRepository;
import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.service.CollectorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CollectorScheduler implements ApplicationRunner {

    public enum Trigger { RUN, SKIP }

    private static final Logger log = LoggerFactory.getLogger(CollectorScheduler.class);

    private final CollectorService collectorService;
    private final CollectorProperties props;
    private final StockInfoRepository stockInfoRepository;
    private final ConceptRepository conceptRepository;

    public CollectorScheduler(CollectorService collectorService, CollectorProperties props,
                              StockInfoRepository stockInfoRepository, ConceptRepository conceptRepository) {
        this.collectorService = collectorService;
        this.props = props;
        this.stockInfoRepository = stockInfoRepository;
        this.conceptRepository = conceptRepository;
    }

    /** 纯逻辑便于测试：auto-full 决定 15:30 是否触发全量 */
    public static Trigger decideFull(CollectorProperties props) {
        return props.isAutoFull() ? Trigger.RUN : Trigger.SKIP;
    }

    @Scheduled(cron = "0 0 9 * * MON-FRI")
    public void refreshStockInfoDaily() {
        try { collectorService.refreshStockInfo(); } catch (Exception e) { log.error("9:00 刷新股票信息失败", e); }
    }

    @Scheduled(cron = "0 5 9 * * MON-FRI")
    public void refreshConceptDaily() {
        try { collectorService.refreshConceptData(); } catch (Exception e) { log.error("9:05 刷新概念板块失败", e); }
    }

    @Scheduled(cron = "0 30 15 * * MON-FRI")
    public void runFullDaily() {
        if (decideFull(props) == Trigger.SKIP) {
            log.info("[定时任务] auto-full=false，跳过 15:30 全量采集");
            return;
        }
        try { collectorService.runFull(0); } catch (Exception e) { log.error("15:30 全量采集失败", e); }
    }

    @Override
    public void run(ApplicationArguments args) {
        // 试运行模式：app.collector.run-sample-on-start=true 时，启动即执行一次小样本采集
        // （spec 要求的 runFull(sampleSize) 手动触发验证入口），默认关闭不影响正常启动。
        if (props.isRunSampleOnStart()) {
            try {
                int n = collectorService.runFull(props.getSampleSize());
                log.info("[启动] run-sample-on-start=true，执行小样本采集 sample-size={}，处理 {} 只", props.getSampleSize(), n);
            } catch (Exception e) {
                log.error("[启动] 小样本采集失败", e);
            }
        }
        // 启动自检开关：测试环境(app.collector.startup-check=false)下跳过，避免 @SpringBootTest 上下文
        // 加载时因测试库 stock_info/concept_board 为空而触发真实网络采集。
        if (!props.isStartupCheck()) {
            log.info("[启动] app.collector.startup-check=false，跳过启动自检");
            return;
        }
        // 启动自检：stock_info 空则跑（auto-full 控制是否全量）；concept_board 空则刷板块
        try {
            if (stockInfoRepository.count() == 0) {
                log.info("[启动] stock_info 为空，自动执行采集");
                if (decideFull(props) == Trigger.RUN) {
                    collectorService.runFull(0);
                } else {
                    collectorService.refreshStockInfo();
                    log.info("[启动] auto-full=false，仅刷新股票信息");
                }
            }
        } catch (Exception e) {
            log.error("[启动] stock_info 自检失败", e);
        }
        try {
            if (conceptRepository.countBoards() == 0) {
                log.info("[启动] 概念板块为空，自动采集");
                collectorService.refreshConceptData();
            }
        } catch (Exception e) {
            log.error("[启动] 概念板块自检失败", e);
        }
    }
}
