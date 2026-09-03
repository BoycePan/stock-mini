package com.guyu.stock.model;

import java.sql.Timestamp;

/**
 * 微信接口凭证行（wx_access_token 表）。
 *
 * <p>每端（source）一行，由 {@code RefreshWxAccessTokenTask} 每 20 分钟刷新，
 * {@code PullWxAdDataTask} 直接取用，不自行换取。</p>
 *
 * <p>{@code expiresAt} 为 token 过期时间（换取时间 + expires_in 秒）；
 * 微信 token 有效期 7200s，每 20 分钟刷一次远早于过期。</p>
 */
public record WxAccessToken(
        long id,
        String target,
        String accessToken,
        Timestamp expiresAt,
        Timestamp refreshedAt,
        Timestamp createdAt) {}
