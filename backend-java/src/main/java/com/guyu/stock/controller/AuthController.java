package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    /** source 可选：标识来源小程序（如 shiChang-tracker / hangQing-tracker），缺省走 default-source（兼容旧小程序） */
    public record LoginRequest(String code, String source) {}

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ApiResponse<Map<String, Object>> login(HttpServletRequest request, @RequestBody LoginRequest req) {
        return ApiResponse.success(authService.login(request, req.source(), req.code()));
    }
}
