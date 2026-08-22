package com.guyu.stock.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.ErrCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 管理端接口（{@code /api/mgr/**}）鉴权拦截器（HandlerInterceptor）。
 *
 * <p>在 {@link WebConfig#addInterceptors} 中注册，只拦截 {@code /api/mgr/**}；
 * 登录接口 {@code POST /api/mgr} 本身不在此路径内，始终放行（用于换取 token）。
 *
 * <p>鉴权逻辑：校验 {@code Authorization: Bearer <token>}，token 必须等于
 * {@code app.mgr.admin-token}（即管理员口令 {@code 用户名@密码} 的 base64）。
 *
 * <p>配置（{@code application.yml} 的 {@code app.mgr} 段）：
 * <ul>
 *   <li>{@code auth-enabled=false} 关闭拦截（调试用，默认 true）。</li>
 * </ul>
 */
@Component
public class MgrAuthInterceptor implements HandlerInterceptor {

    private final AppProperties.Mgr cfg;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MgrAuthInterceptor(AppProperties appProperties) {
        this.cfg = appProperties.getMgr();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (!cfg.isAuthEnabled()) {
            return true;
        }

        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || authHeader.isBlank() || !authHeader.startsWith("Bearer ")) {
            return reject(response, ErrCode.TOKEN_MISSING, ErrCode.msg(ErrCode.TOKEN_MISSING));
        }
        String token = authHeader.substring("Bearer ".length());

        if (token.isEmpty() || !token.equals(cfg.getAdminToken())) {
            return reject(response, ErrCode.TOKEN_INVALID, ErrCode.msg(ErrCode.TOKEN_INVALID));
        }
        return true;
    }

    private boolean reject(HttpServletResponse response, int code, String msg) throws Exception {
        response.setStatus(200);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(code, msg)));
        return false;
    }
}
