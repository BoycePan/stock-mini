package com.guyu.stock.config;

import com.guyu.stock.service.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 可选鉴权拦截器（Optional Auth）。
 *
 * <p>与 {@link AuthInterceptor}（强制鉴权，无 token 直接拒绝）不同，本拦截器
 * 「尽力而为」：携带 {@code Authorization: Bearer <token>} 且 token 有效时，
 * 把 {@code user_id} / {@code openid} 写入请求上下文；未携带或 token 无效时
 * <b>照常放行</b>（此时 {@code user_id} 为 null）。
 *
 * <p>用途：打点上报等「允许匿名、但登录态可增强数据」的接口。前端埋点 SDK 登录后
 * 会带 token，登录前匿名上报也能落库（user_id=null）。
 */
@Component
public class OptionalAuthInterceptor implements HandlerInterceptor {

    private final JwtService jwtService;

    public OptionalAuthInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || authHeader.isBlank() || !authHeader.startsWith("Bearer ")) {
            return true;
        }
        String token = authHeader.substring("Bearer ".length()).trim();
        if (token.isEmpty()) {
            return true;
        }
        try {
            JwtService.JwtClaims claims = jwtService.parseToken(token);
            request.setAttribute("user_id", claims.userId());
            request.setAttribute("openid", claims.openid());
        } catch (Exception ignored) {
            // token 无效：不拒绝，按匿名处理（user_id 不设置）
        }
        return true;
    }
}
