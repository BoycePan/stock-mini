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

    @Data
    public static class Sina {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }
}
