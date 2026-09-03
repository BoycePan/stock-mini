package com.guyu.stock.dao;

import com.guyu.stock.model.WxAccessToken;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 微信接口凭证（wx_access_token 表）。
 *
 * <p>每端（target）一行，{@code RefreshWxAccessTokenTask} 每 20 分钟刷新，
 * {@code PullWxAdDataTask} 读取最新 token 使用。</p>
 */
@Repository
public class WxAccessTokenRepository {

    private final JdbcTemplate jdbcTemplate;

    public WxAccessTokenRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<WxAccessToken> MAPPER = (rs, i) -> new WxAccessToken(
            rs.getLong("id"),
            rs.getString("target"),
            rs.getString("access_token"),
            rs.getTimestamp("expires_at"),
            rs.getTimestamp("refreshed_at"),
            rs.getTimestamp("created_at"));

    public Optional<WxAccessToken> findByTarget(String target) {
        List<WxAccessToken> rows = jdbcTemplate.query(
                "SELECT id, target, access_token, expires_at, refreshed_at, created_at FROM wx_access_token WHERE target = ?",
                MAPPER, target);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * 按 target 单行 upsert（刷新即覆盖）。与 StockKlineRepository 同一约定：
     * 先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING，兼容 H2 测试库与生产 PostgreSQL。
     */
    public void upsert(String target, String accessToken, Timestamp expiresAt) {
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        int updated = jdbcTemplate.update("""
                UPDATE wx_access_token SET access_token=?, expires_at=?, refreshed_at=?
                WHERE target=?
                """, accessToken, expiresAt, now, target);
        if (updated == 0) {
            jdbcTemplate.update("""
                    INSERT INTO wx_access_token (target, access_token, expires_at, refreshed_at)
                    VALUES (?,?,?,?)
                    ON CONFLICT DO NOTHING
                    """, target, accessToken, expiresAt, now);
        }
    }
}
