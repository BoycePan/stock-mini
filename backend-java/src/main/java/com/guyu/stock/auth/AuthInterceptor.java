package com.guyu.stock.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.ErrCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final JwtService jwtService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AuthInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || authHeader.isBlank()) {
            return reject(response, ErrCode.TOKEN_MISSING, ErrCode.msg(ErrCode.TOKEN_MISSING));
        }
        if (!authHeader.startsWith("Bearer ")) {
            return reject(response, ErrCode.TOKEN_MISSING, "认证格式错误，应为 Bearer <token>");
        }
        String token = authHeader.substring("Bearer ".length());
        try {
            JwtService.JwtClaims claims = jwtService.parseToken(token);
            request.setAttribute("user_id", claims.userId());
            request.setAttribute("openid", claims.openid());
            return true;
        } catch (Exception e) {
            return reject(response, ErrCode.TOKEN_INVALID, ErrCode.msg(ErrCode.TOKEN_INVALID));
        }
    }

    private boolean reject(HttpServletResponse response, int code, String msg) throws Exception {
        response.setStatus(200);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(code, msg)));
        return false;
    }
}
