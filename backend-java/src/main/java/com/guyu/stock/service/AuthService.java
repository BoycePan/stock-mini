package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.UserRepository;
import com.guyu.stock.model.User;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 微信登录编排（对齐 Go service.NewAuthService）。
 * 吸收原 AuthController 的登录逻辑：code2Session → 用户 find-or-create → 签发 JWT → 组装响应。
 * source 标识来源小程序（如 shiChang-tracker / hangQing-tracker），未携带时用配置的 default-source。
 */
@Slf4j
@Service
public class AuthService {

    private final WechatService wechatService;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final AppProperties appProperties;

    public AuthService(WechatService wechatService, UserRepository userRepository,
                       JwtService jwtService, AppProperties appProperties) {
        this.wechatService = wechatService;
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.appProperties = appProperties;
    }

    public Map<String, Object> login(HttpServletRequest request, String source, String code) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "code 不能为空");
        }
        // 未携带 source 时走默认来源（兼容已发布旧小程序，无需发版）
        String resolvedSource = (source == null || source.isBlank())
                ? appProperties.getWechat().getDefaultSource()
                : source;
        try {
            Map<String, Object> session = wechatService.code2Session(resolvedSource, code);
            String openid = (String) session.get("openid");
            String sessionKey = (String) session.get("session_key");
            String unionid = session.get("unionid") == null ? null : (String) session.get("unionid");

            User user = userRepository.findBySourceAndOpenId(resolvedSource, openid);
            if (user == null) {
                user = userRepository.create(new User(0, resolvedSource, openid, unionid, sessionKey, null, null, null, 1, null, null, null));
            } else {
                user = new User(
                        user.id(), user.source(), user.openid(),
                        unionid != null ? unionid : user.unionid(),
                        sessionKey,
                        user.nickname(), user.avatarUrl(), user.phoneEnc(), user.status(),
                        user.lastLoginAt(), user.createdAt(), user.updatedAt());
                userRepository.updateLogin(user);
            }

            String token = jwtService.generateToken(user.id(), user.openid());
            int expireHours = appProperties.getJwt().getExpireHours();
            if (expireHours <= 0) expireHours = 24;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("token", token);
            result.put("expires_in", (long) expireHours * 3600);
            result.put("user", user);

            // id 存入上下文，方便后续打日志
            request.setAttribute("user_id", user.id());

            return result;
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            log.error("微信登录失败 ", e);
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
    }
}
