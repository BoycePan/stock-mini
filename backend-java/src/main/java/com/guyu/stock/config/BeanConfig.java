package com.guyu.stock.config;

import com.guyu.stock.service.JwtService;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.eastmoney.EastmoneyKlineClient;
import com.guyu.stock.external.sina.SinaClient;
import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.external.rss.RssNewsClient;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BeanConfig {

    @Bean
    public JwtService jwtService(AppProperties appProperties) {
        return new JwtService(appProperties.getJwt());
    }

    @Bean
    public SinaClient sinaClient(AppProperties appProperties) {
        return new SinaClient(appProperties.getSina());
    }

    // ---------- C 阶段：外部采集数据源与客户端 ----------
    // 四个数据源（新浪/东方财富/同花顺/巨潮）的限流/重试/超时全部来自 app.* 配置，
    // 对齐 Go 版 backend/config.yaml 的 stock 段（见 application.yml）。

    @Bean
    public DataSource sinaSource(AppProperties appProperties) {
        AppProperties.Sina cfg = appProperties.getSina();
        return new DataSource("sina", cfg.getRateLimitSeconds(), cfg.getMaxRetries(),
                cfg.getUserAgent(), cfg.getReferer(), cfg.getTimeoutSeconds());
    }

    @Bean
    public DataSource thsSource(AppProperties appProperties) {
        AppProperties.Ths cfg = appProperties.getThs();
        return new DataSource("ths", cfg.getRateLimitSeconds(), cfg.getMaxRetries(),
                cfg.getUserAgent(), cfg.getReferer(), cfg.getTimeoutSeconds());
    }

    @Bean
    public DataSource cninfoSource(AppProperties appProperties) {
        AppProperties.Cninfo cfg = appProperties.getCninfo();
        return new DataSource("cninfo", cfg.getRateLimitSeconds(), cfg.getMaxRetries(),
                cfg.getUserAgent(), cfg.getReferer(), cfg.getTimeoutSeconds());
    }

    @Bean
    public DataSource eastmoneySource(AppProperties appProperties) {
        AppProperties.Eastmoney cfg = appProperties.getEastmoney();
        return new DataSource("eastmoney", cfg.getRateLimitSeconds(), cfg.getMaxRetries(),
                cfg.getUserAgent(), cfg.getReferer(), cfg.getTimeoutSeconds());
    }

    @Bean
    public SinaKlineClient sinaKlineClient(DataSource sinaSource) {
        return new SinaKlineClient(sinaSource, 1000);
    }

    @Bean
    public SinaInfoClient sinaInfoClient(DataSource sinaSource) {
        return new SinaInfoClient(sinaSource);
    }

    @Bean
    public SinaNewsClient sinaNewsClient(DataSource sinaSource) {
        return new SinaNewsClient(sinaSource, 1000);
    }

    @Bean
    public ThsClient thsClient(DataSource thsSource) {
        return new ThsClient(thsSource, 1000);
    }

    @Bean
    public CninfoClient cninfoClient(DataSource cninfoSource) {
        return new CninfoClient(cninfoSource, 1000);
    }

    @Bean
    public EastmoneyKlineClient eastmoneyKlineClient(DataSource eastmoneySource) {
        return new EastmoneyKlineClient(eastmoneySource);
    }

    // ---------- D 阶段：雅虎 Python sidecar ----------
    // baseUrl 来自 app.fetch.host/port（默认 127.0.0.1:8001），sidecar 由 FetchSidecarLauncher 拉起。
    @Bean
    public YahooKlineClient yahooKlineClient(AppProperties appProperties) {
        AppProperties.Fetch cfg = appProperties.getFetch();
        return new YahooKlineClient("http://" + cfg.getHost() + ":" + cfg.getPort());
    }

    // ---------- RSS 新闻源 ----------
    // 源列表在数据库 rss_source 表（见 scripts/rss_source.sql）；这里只装配抓取通道：
    // rssDirectSource 直连（中文源），rssWorkerSource 走 Cloudflare Worker（海外源，未配置时退化为直连）。
    private static final String RSS_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    @Bean
    public DataSource rssDirectSource() {
        return new DataSource("rss", 1.0, 3, RSS_UA, null, 20);
    }

    @Bean
    public DataSource rssWorkerSource(RssProperties rssProperties) {
        String base = rssProperties.getWorkerBase();
        if (base == null || base.isBlank()) {
            // 未配置 Worker：退化为直连（RssNewsClient.hasWorker()=false，via-worker 源会被跳过并打 warn）
            return new DataSource("rss-worker", 1.0, 3, RSS_UA, null, 20);
        }
        return new DataSource("rss-worker", 1.0, 3, RSS_UA, null, 20, base, rssProperties.getAuthToken());
    }

    @Bean
    public RssNewsClient rssNewsClient(DataSource rssDirectSource, DataSource rssWorkerSource) {
        return new RssNewsClient(rssDirectSource, rssWorkerSource);
    }
}
