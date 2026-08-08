package com.guyu.stock.auth;

import com.guyu.stock.config.AppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class AuthInterceptorTest {

    private static final String TEST_SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private JwtService jwtService;
    private AuthInterceptor interceptor;

    @BeforeEach
    void setUp() {
        AppProperties.Jwt jwtCfg = new AppProperties.Jwt();
        jwtCfg.setSecret(TEST_SECRET);
        jwtCfg.setExpireHours(24);
        jwtService = new JwtService(jwtCfg);
        interceptor = new AuthInterceptor(jwtService);
    }

    @Test
    void missingTokenRejected() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/user/profile");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        boolean ok = interceptor.preHandle(req, resp, new Object());
        assertThat(ok).isFalse();
        assertThat(resp.getStatus()).isEqualTo(200);
    }

    @Test
    void validTokenAccepted() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/user/profile");
        req.addHeader("Authorization", "Bearer " + jwtService.generateToken(7, "openid-x"));
        boolean ok = interceptor.preHandle(req, new MockHttpServletResponse(), new Object());
        assertThat(ok).isTrue();
        assertThat(req.getAttribute("user_id")).isEqualTo(7L);
    }
}
