package com.guyu.stock.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

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
    private Fetch fetch = new Fetch();
    private Logging logging = new Logging();
    private Mgr mgr = new Mgr();
    private Tracking tracking = new Tracking();

    @Data
    public static class Jwt {
        private String secret;
        private int expireHours;
    }

    /**
     * 微信小程序配置：按来源（source）区分各小程序的 appid/secret。
     * login 请求未携带 source 时走 {@link #defaultSource}（兼容已发布旧小程序）。
     */
    @Data
    public static class Wechat {
        /** 登录请求未携带 source 时默认使用的小程序来源 */
        private String defaultSource = "shiChang-tracker";
        /** 来源 → 小程序 appid/secret 映射 */
        private Map<String, App> apps = new HashMap<>();

        @Data
        public static class App {
            private String appId;
            private String appSecret;
        }
    }

    /** 数据源公共配置段，字段对齐 Go 版 config.yaml 的 stock.<source>.rate_limit / max_retries / timeout */
    @Data
    public static class Sina {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
        /** 通用新闻 feed 定时拉取开关（SinaFeedScheduler，每 5 分钟） */
        private boolean feedEnabled = true;
        /** feed 关键词，默认「A股」（与原 /news/feed 默认一致） */
        private String feedKeyword = "A股";
        /** 每轮拉取条数 */
        private int feedCount = 20;
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

    /** 雅虎 Python sidecar（方案 A）启动配置，见 scripts/fetch_service.py */
    @Data
    public static class Fetch {
        /** 是否在 Java 启动时拉起 Python sidecar（默认 true；镜像已内置脚本与依赖） */
        private boolean enabled = true;
        /** Python 脚本路径（相对工作目录） */
        private String scriptPath = "scripts/fetch_service.py";
        /** Python 可执行文件 */
        private String python = "python3";
        /** sidecar 监听地址（脚本内固定 127.0.0.1） */
        private String host = "127.0.0.1";
        /** sidecar 端口，默认 8001 */
        private int port = 8001;
        /** 启动后健康检查超时（秒） */
        private int startupTimeoutSeconds = 30;
        /** 本机开发代理（如 http://127.0.0.1:7890），注入给 Python 侧让 yfinance 走代理；生产海外留空=直连 */
        private String httpsProxy;
        private String httpProxy;
        /** Cloudflare Worker 反向代理地址（如 https://proxy.lilaiyun.online）；留空=直连/走 Clash 代理 */
        private String workerBase;
        /** Worker 鉴权 token（X-Auth-Token） */
        private String authToken;
        /** 是否每天 6:00 自动拉取全球指数并同步元数据（美股收盘后所有市场均已收盘） */
        private boolean autoFetch = true;
        /** 是否开启快照定时刷新（60s 拉最新点位落 quote_snapshot） */
        private boolean snapshotEnabled = true;
        /** 快照刷新间隔（毫秒），默认 60s（防雅虎限流） */
        private long snapshotIntervalMs = 60000;
    }

    /** HTTP 请求耗时日志配置（RequestLogFilter 使用） */
    @Data
    public static class Logging {
        /** 是否记录每个请求的耗时日志，默认 true；false 时 RequestLogFilter 不输出 */
        private boolean requestEnabled = true;
        /** 慢请求阈值（毫秒），&gt;0 时耗时 ≥ 该值的请求以 WARN 记录，0 表示全部按 INFO */
        private int slowRequestMs = 0;
    }

    /** 管理端接口（/api/mgr/**）鉴权配置（MgrAuthInterceptor 使用） */
    @Data
    public static class Mgr {
        /** 是否启用 /api/mgr/** 拦截，默认 true；false 时放行所有 mgr 请求（调试用） */
        private boolean authEnabled = true;

        private String adminToken;
    }

    /** 用户行为打点上报配置（TrackService 使用） */
    @Data
    public static class Tracking {
        /** 是否启用打点上报接口，默认 true；false 时 TrackController 仍可用但可直接关闭以省资源 */
        private boolean enabled = true;

        /** 单批最多接受的事件条数，默认 100（超出按 400 拒绝，防止恶意 / 超大 payload） */
        private int maxBatchSize = 100;
    }
}
