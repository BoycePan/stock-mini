package com.guyu.stock.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * 开发模式：Java 启动后拉起雅虎 Python sidecar（scripts/fetch_service.py）。
 *
 * 生产环境建议 app.fetch.enabled=false，sidecar 单独部署（Docker Compose / systemd），
 * 避免 Java 强杀时 Python 变孤儿进程。
 */
@Component
public class FetchSidecarLauncher implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(FetchSidecarLauncher.class);

    private final AppProperties appProperties;

    public FetchSidecarLauncher(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    @Override
    public void run(ApplicationArguments args) {
        AppProperties.Fetch cfg = appProperties.getFetch();
        if (!cfg.isEnabled()) {
            log.info("[fetch-sidecar] app.fetch.enabled=false，跳过拉起");
            return;
        }
        File script = new File(cfg.getScriptPath());
        if (!script.isFile()) {
            log.warn("[fetch-sidecar] 未找到脚本 {}，跳过拉起", script.getAbsolutePath());
            return;
        }
        Process process;
        try {
            ProcessBuilder pb = new ProcessBuilder(cfg.getPython(), script.getAbsolutePath());
            if (cfg.getHttpsProxy() != null && !cfg.getHttpsProxy().isBlank()) {
                pb.environment().put("HTTPS_PROXY", cfg.getHttpsProxy());
            }
            if (cfg.getHttpProxy() != null && !cfg.getHttpProxy().isBlank()) {
                pb.environment().put("HTTP_PROXY", cfg.getHttpProxy());
            }
            // Cloudflare Worker 反向代理通道：sidecar 走 Worker 则无需 Clash 代理（fetch_service.py 读取）
            if (cfg.getWorkerBase() != null && !cfg.getWorkerBase().isBlank()) {
                pb.environment().put("YF_WORKER_BASE", cfg.getWorkerBase());
            }
            if (cfg.getAuthToken() != null && !cfg.getAuthToken().isBlank()) {
                pb.environment().put("YF_AUTH_TOKEN", cfg.getAuthToken());
            }
            process = pb.inheritIO().start();
        } catch (IOException e) {
            log.error("[fetch-sidecar] 启动 Python 失败: {}", e.getMessage());
            return;
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            process.destroy();
            log.info("[fetch-sidecar] 已随 Java 进程退出");
        }));
        if (waitHealthy(cfg)) {
            log.info("[fetch-sidecar] 就绪: http://{}:{}/health", cfg.getHost(), cfg.getPort());
        } else {
            log.error("[fetch-sidecar] {}s 内健康检查未通过，已终止拉起（请确认: pip3 install fastapi uvicorn）",
                    cfg.getStartupTimeoutSeconds());
            process.destroy();
        }
    }

    private boolean waitHealthy(AppProperties.Fetch cfg) {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
        URI health = URI.create("http://" + cfg.getHost() + ":" + cfg.getPort() + "/health");
        long deadline = System.currentTimeMillis() + cfg.getStartupTimeoutSeconds() * 1000L;
        while (System.currentTimeMillis() < deadline) {
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(health)
                        .timeout(Duration.ofSeconds(3))
                        .GET().build();
                HttpResponse<Void> resp = client.send(req, HttpResponse.BodyHandlers.discarding());
                if (resp.statusCode() == 200) {
                    return true;
                }
            } catch (Exception ignored) {
                // sidecar 尚未就绪，继续轮询
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
}
