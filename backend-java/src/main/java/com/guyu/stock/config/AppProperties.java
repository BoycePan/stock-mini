package com.guyu.stock.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private Jwt jwt = new Jwt();
    private Wechat wechat = new Wechat();
    private Sina sina = new Sina();
    private Eastmoney eastmoney = new Eastmoney();
    private Cninfo cninfo = new Cninfo();
    private Ths ths = new Ths();

    @Data
    public static class Jwt {
        private String secret;
        private int expireHours;
    }

    @Data
    public static class Wechat {
        private String appId;
        private String appSecret;
    }

    /** 数据源公共配置段，字段对齐 Go 版 config.yaml 的 stock.<source>.rate_limit / max_retries / timeout */
    @Data
    public static class Sina {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }

    @Data
    public static class Eastmoney {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }

    @Data
    public static class Cninfo {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }

    @Data
    public static class Ths {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }
}
