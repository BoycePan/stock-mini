package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

public class JwtService {

    public record JwtClaims(long userId, String openid) {}

    private final AppProperties.Jwt jwtCfg;
    private final SecretKey key;

    public JwtService(AppProperties.Jwt jwtCfg) {
        this.jwtCfg = jwtCfg;
        byte[] keyBytes = jwtCfg.getSecret() == null ? new byte[0] : jwtCfg.getSecret().getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            throw new IllegalStateException("JWT secret must be at least 32 bytes (got " + keyBytes.length + "); set app.jwt.secret / JWT_SECRET");
        }
        // 与 Go []byte(secret) 完全一致：用 secret 字符串的 UTF-8 字节作为 HMAC 密钥
        this.key = Keys.hmacShaKeyFor(keyBytes);
    }

    public String generateToken(long userId, String openid) {
        int hours = jwtCfg.getExpireHours() <= 0 ? 24 : jwtCfg.getExpireHours();
        Instant now = Instant.now();
        return Jwts.builder()
                .claim("user_id", userId)
                .claim("openid", openid)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(Duration.ofHours(hours))))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    public JwtClaims parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Object uid = claims.get("user_id");
            long userId = uid instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(uid));
            return new JwtClaims(userId, claims.get("openid", String.class));
        } catch (Exception e) {
            throw new BizException(ErrCode.TOKEN_INVALID, ErrCode.msg(ErrCode.TOKEN_INVALID));
        }
    }
}
