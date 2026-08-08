package com.guyu.stock.auth;

import com.guyu.stock.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/user")
public class UserController {

    @GetMapping("/profile")
    public ApiResponse<Object> profile(HttpServletRequest request) {
        Object userId = request.getAttribute("user_id");
        return ApiResponse.success(userId);
    }
}
