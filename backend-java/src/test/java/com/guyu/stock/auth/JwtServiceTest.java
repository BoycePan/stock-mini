package com.guyu.stock.auth;

import com.guyu.stock.common.BizException;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.JwtService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    // 测试专用密钥（>=32 字节），非生产值
    private static final String TEST_SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private final JwtService jwtService = new JwtService(jwtCfg());

    private static AppProperties.Jwt jwtCfg() {
        AppProperties.Jwt cfg = new AppProperties.Jwt();
        cfg.setSecret(TEST_SECRET);
        cfg.setExpireHours(24);
        return cfg;
    }

    @Test
    void generateAndParse() {
        String token = jwtService.generateToken(42, "openid-abc");
        JwtService.JwtClaims claims = jwtService.parseToken(token);
        assertThat(claims.userId()).isEqualTo(42);
        assertThat(claims.openid()).isEqualTo("openid-abc");
    }

    @Test
    void invalidTokenThrows() {
        assertThatThrownBy(() -> jwtService.parseToken("garbage.token.value"))
                .isInstanceOf(BizException.class);
    }
}
