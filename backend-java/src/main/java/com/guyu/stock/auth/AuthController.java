package com.guyu.stock.auth;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.user.User;
import com.guyu.stock.user.UserRepository;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final WechatService wechatService;
    private final UserRepository userRepository;
    private final JwtService jwtService;

    public AuthController(WechatService wechatService, UserRepository userRepository, JwtService jwtService) {
        this.wechatService = wechatService;
        this.userRepository = userRepository;
        this.jwtService = jwtService;
    }

    public record LoginRequest(String code) {}

    @PostMapping("/login")
    public ApiResponse<Map<String, Object>> login(@RequestBody LoginRequest req) {
        if (req.code() == null || req.code().isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "code 不能为空");
        }
        try {
            Map<String, Object> session = wechatService.code2Session(req.code());
            String openid = (String) session.get("openid");
            String sessionKey = (String) session.get("session_key");
            String unionid = session.get("unionid") == null ? null : (String) session.get("unionid");

            User user = userRepository.findByOpenId(openid);
            if (user == null) {
                user = userRepository.create(new User(0, openid, unionid, sessionKey, null, null, null, 1, null, null, null));
            } else {
                userRepository.updateLogin(user);
            }

            String token = jwtService.generateToken(user.id(), user.openid());
            int expireHours = 24;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("token", token);
            result.put("expires_in", (long) expireHours * 3600);
            result.put("user", user);
            return ApiResponse.success(result);
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
    }
}
