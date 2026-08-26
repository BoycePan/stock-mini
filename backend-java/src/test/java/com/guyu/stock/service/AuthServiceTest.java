package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.UserRepository;
import com.guyu.stock.model.User;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthServiceTest {

    private final WechatService wechatService = mock(WechatService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final JwtService jwtService = mock(JwtService.class);
    private final AppProperties appProperties = mock(AppProperties.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final AuthService authService =
            new AuthService(wechatService, userRepository, jwtService, appProperties);

    @BeforeEach
    void setUp() {
        when(appProperties.getWechat()).thenReturn(wechatCfg());
        when(appProperties.getJwt()).thenReturn(new AppProperties.Jwt());
    }

    private AppProperties.Wechat wechatCfg() {
        AppProperties.Wechat wechat = new AppProperties.Wechat();
        wechat.setDefaultSource("shiChang-tracker");
        AppProperties.Wechat.App stock = new AppProperties.Wechat.App();
        stock.setAppId("wx-stock-id");
        stock.setAppSecret("stock-secret");
        AppProperties.Wechat.App newApp = new AppProperties.Wechat.App();
        newApp.setAppId("wx-hangQing-tracker-id");
        newApp.setAppSecret("hangQing-tracker-secret");
        wechat.getApps().put("shiChang-tracker", stock);
        wechat.getApps().put("hangQing-tracker", newApp);
        return wechat;
    }

    private void stubNewUserLogin(String source, String openid, String code) {
        when(wechatService.code2Session(source, code))
                .thenReturn(Map.of("openid", openid, "session_key", "sk-" + openid));
        when(userRepository.findBySourceAndOpenId(source, openid)).thenReturn(null);
        when(userRepository.create(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jwtService.generateToken(anyLong(), anyString())).thenReturn("jwt-token");
    }

    @Test
    void loginWithoutSourceUsesDefaultSource() {
        stubNewUserLogin("shiChang-tracker", "openid-1", "code-1");

        Map<String, Object> result = authService.login(request, null, "code-1");

        verify(wechatService).code2Session("shiChang-tracker", "code-1");
        verify(userRepository).findBySourceAndOpenId("shiChang-tracker", "openid-1");
        assertEquals("jwt-token", result.get("token"));
        // expireHours=0 兜底 24h
        assertEquals(86400L, result.get("expires_in"));
        User user = (User) result.get("user");
        assertNotNull(user);
        assertEquals("shiChang-tracker", user.source());
        assertEquals("openid-1", user.openid());
        verify(request).setAttribute("user_id", 0L);
    }

    @Test
    void loginWithSourcePassesSourceThrough() {
        stubNewUserLogin("hangQing-tracker", "openid-2", "code-2");

        authService.login(request, "hangQing-tracker", "code-2");

        verify(wechatService).code2Session("hangQing-tracker", "code-2");
        verify(userRepository).findBySourceAndOpenId("hangQing-tracker", "openid-2");
        verify(userRepository, never()).findBySourceAndOpenId("shiChang-tracker", "openid-2");
    }

    @Test
    void loginWithBlankSourceFallsBackToDefault() {
        stubNewUserLogin("shiChang-tracker", "openid-3", "code-3");

        authService.login(request, "  ", "code-3");

        verify(wechatService).code2Session("shiChang-tracker", "code-3");
    }

    @Test
    void loginUnknownSourceRejects() {
        // WechatService 对未配置的 source 抛 INVALID_PARAM，AuthService 原样透传
        when(wechatService.code2Session("unknown", "code-4"))
                .thenThrow(new BizException(ErrCode.INVALID_PARAM, "未知的 source: unknown"));

        BizException ex = assertThrows(BizException.class,
                () -> authService.login(request, "unknown", "code-4"));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(userRepository, never()).findBySourceAndOpenId(anyString(), anyString());
    }

    @Test
    void loginExistingUserUpdatesLoginAndKeepsProfile() {
        User existing = new User(7, "shiChang-tracker", "openid-5", "old-unionid", "old-sk",
                "nickname", "avatar.png", "phone-enc", 1, null, null, null);
        when(wechatService.code2Session("shiChang-tracker", "code-5"))
                .thenReturn(Map.of("openid", "openid-5", "session_key", "new-sk", "unionid", "new-unionid"));
        when(userRepository.findBySourceAndOpenId("shiChang-tracker", "openid-5")).thenReturn(existing);
        when(jwtService.generateToken(7L, "openid-5")).thenReturn("jwt-token");

        Map<String, Object> result = authService.login(request, null, "code-5");

        verify(userRepository).updateLogin(any(User.class));
        User user = (User) result.get("user");
        assertEquals(7, user.id());
        assertEquals("nickname", user.nickname());
        assertEquals("new-unionid", user.unionid());
        verify(request).setAttribute("user_id", 7L);
    }

    @Test
    void loginEmptyCodeRejectsBeforeWechatCall() {
        BizException ex = assertThrows(BizException.class,
                () -> authService.login(request, "shiChang-tracker", "  "));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(wechatService, never()).code2Session(anyString(), anyString());
    }
}
