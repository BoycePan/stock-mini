package com.guyu.stock.dao;

import com.guyu.stock.model.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.LocalDateTime;

@Repository
public class UserRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<User> MAPPER = (rs, i) -> {
        Timestamp last = rs.getTimestamp("last_login_at");
        Timestamp created = rs.getTimestamp("created_at");
        Timestamp updated = rs.getTimestamp("updated_at");
        return new User(
                rs.getLong("id"),
                rs.getString("source"),
                rs.getString("openid"),
                rs.getString("unionid"),
                rs.getString("session_key"),
                rs.getString("nickname"),
                rs.getString("avatar_url"),
                rs.getString("phone_enc"),
                rs.getInt("status"),
                last != null ? last.toLocalDateTime() : null,
                created != null ? created.toLocalDateTime() : null,
                updated != null ? updated.toLocalDateTime() : null
        );
    };

    /** openid 仅在同 source（小程序）内唯一，查询必须带 source */
    public User findBySourceAndOpenId(String source, String openid) {
        var users = jdbcTemplate.query("SELECT * FROM users WHERE source = ? AND openid = ?", MAPPER, source, openid);
        return users.isEmpty() ? null : users.get(0);
    }

    public User create(User user) {
        LocalDateTime now = LocalDateTime.now();
        KeyHolder kh = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO users (source, openid, unionid, session_key, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?) RETURNING id",
                    new String[]{"id"});
            ps.setString(1, user.source());
            ps.setString(2, user.openid());
            ps.setString(3, user.unionid());
            ps.setString(4, user.sessionKey());
            ps.setInt(5, 1);
            ps.setTimestamp(6, Timestamp.valueOf(now));
            ps.setTimestamp(7, Timestamp.valueOf(now));
            return ps;
        }, kh);
        return new User(kh.getKey().longValue(), user.source(), user.openid(), user.unionid(), user.sessionKey(), user.nickname(), user.avatarUrl(), user.phoneEnc(), user.status(), user.lastLoginAt(), now, now);
    }

    public void updateLogin(User user) {
        jdbcTemplate.update(
                "UPDATE users SET session_key = ?, unionid = COALESCE(?, unionid), last_login_at = ?, updated_at = ? WHERE id = ?",
                user.sessionKey(), user.unionid(), Timestamp.valueOf(LocalDateTime.now()),
                Timestamp.valueOf(LocalDateTime.now()), user.id());
    }
}
