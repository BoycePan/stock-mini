package com.guyu.stock.news;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class NewsRepository {

    public record NewsRow(String stockCode, String title, String summary, String url, String source, String publishedAt) {}

    private final JdbcTemplate jdbcTemplate;

    public NewsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<NewsRow> MAPPER = (rs, i) -> new NewsRow(
            rs.getString("stock_code"), rs.getString("title"), rs.getString("summary"),
            rs.getString("url"), rs.getString("source"), rs.getString("published_at"));

    public void batchSave(List<NewsRow> rows) {
        if (rows == null || rows.isEmpty()) return;
        for (NewsRow row : rows) {
            // 注意：Go 侧使用 $6::timestamptz；Java 用全称 TIMESTAMP WITH TIME ZONE
            // （TIMESTAMPTZ 即其缩写）。H2 测试库无法解析 TIMESTAMPTZ 别名（已验证 2.2.224/2.3.232），
            // 全称在 H2 与生产 PostgreSQL 均兼容，语义完全一致。
            jdbcTemplate.update("""
                    INSERT INTO news_feed (stock_code, title, summary, url, source, published_at)
                    VALUES (?,?,?,?,?,CAST(? AS TIMESTAMP WITH TIME ZONE))
                    ON CONFLICT DO NOTHING
                    """, row.stockCode(), row.title(), row.summary(), row.url(), row.source(), row.publishedAt());
        }
    }

    public List<NewsRow> queryByStock(String code, int limit) {
        if (limit <= 0) limit = 50;
        return jdbcTemplate.query("""
                SELECT stock_code, title, summary, url, source,
                       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
                FROM news_feed WHERE stock_code = ? ORDER BY published_at DESC LIMIT ?
                """, MAPPER, code, limit);
    }
}
