package com.guyu.stock.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 每个 HTTP 请求的耗时日志过滤器。
 *
 * <p>基于 {@link OncePerRequestFilter}，一次请求只记一条日志，覆盖所有路径
 * （含健康检查、404 等未命中 Controller 的请求）。记录内容：
 * 方法、URI（含查询串）、响应状态码、耗时(ms)、客户端 IP、登录用户 id。
 *
 * <p>可通过配置控制：
 * <ul>
 *   <li>{@code app.logging.request-enabled=false} 整体关闭请求耗时日志；</li>
 *   <li>{@code app.logging.slow-request-ms=N}（N&gt;0）时，耗时 ≥ N ms 的请求升级为 WARN 日志，便于筛选慢请求。</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestLogFilter.class);

    private final AppProperties.Logging cfg;

    public RequestLogFilter(AppProperties appProperties) {
        this.cfg = appProperties.getLogging();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        boolean failed = false;
        try {
            filterChain.doFilter(request, response);
        } catch (Exception e) {
            // 未被 GlobalExceptionHandler 等接住的异常：记 ERROR（含耗时）后原样抛出
            failed = true;
            log.error("[http] {} {} FAILED cost={}ms ip={} uid={}",
                    request.getMethod(), fullUri(request), costMs(start),
                    clientIp(request), request.getAttribute("user_id"), e);
            throw e;
        } finally {
            if (!failed) {
                logRequest(request, response, start);
            }
        }
    }

    private void logRequest(HttpServletRequest request, HttpServletResponse response, long startNanos) {
        if (!cfg.isRequestEnabled()) {
            return;
        }
        long costMs = costMs(startNanos);
        int status = response.getStatus();
        String method = request.getMethod();
        String uri = fullUri(request);
        String ip = clientIp(request);
        Object uid = request.getAttribute("user_id");

        boolean slow = cfg.getSlowRequestMs() > 0 && costMs >= cfg.getSlowRequestMs();
        if (slow) {
            log.warn("[http] {} {} status={} cost={}ms ip={} uid={}", method, uri, status, costMs, ip, uid);
        } else {
            log.info("[http] {} {} status={} cost={}ms ip={} uid={}", method, uri, status, costMs, ip, uid);
        }
    }

    /** URI + 查询串，方便区分同一路径的不同参数（如 klines?scale=240 vs scale=5） */
    private static String fullUri(HttpServletRequest request) {
        String query = request.getQueryString();
        return (query == null || query.isBlank()) ? request.getRequestURI() : request.getRequestURI() + "?" + query;
    }

    /** 优先取 X-Forwarded-For 第一个 IP（nginx 反代场景），否则用直连地址 */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return comma > 0 ? forwarded.substring(0, comma).trim() : forwarded.trim();
        }
        return request.getRemoteAddr();
    }

    private static long costMs(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000;
    }
}
