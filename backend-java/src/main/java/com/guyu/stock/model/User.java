package com.guyu.stock.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record User(
        long id,
        @JsonIgnore String openid,
        @JsonIgnore String unionid,
        @JsonIgnore String sessionKey,
        String nickname,
        @JsonProperty("avatar_url") String avatarUrl,
        @JsonIgnore String phoneEnc,
        int status,
        @JsonProperty("last_login_at") LocalDateTime lastLoginAt,
        @JsonProperty("created_at") LocalDateTime createdAt,
        @JsonProperty("updated_at") LocalDateTime updatedAt
) {
    public User withId(long newId) {
        return new User(newId, openid, unionid, sessionKey, nickname, avatarUrl, phoneEnc, status, lastLoginAt, createdAt, updatedAt);
    }
}
