package com.guyu.stock.dao;

import com.guyu.stock.model.NewsRow;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

@Repository
public class NewsRepository {

    private final JdbcTemplate jdbcTemplate;

    public NewsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<NewsRow> MAPPER = (rs, i) -> new NewsRow(
            rs.getLong("id"), rs.getString("stock_code"), rs.getString("title"), rs.getString("summary"),
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
                SELECT id, stock_code, title, summary, url, source,
                       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
                FROM news_feed WHERE stock_code = ? ORDER BY published_at DESC LIMIT ?
                """, MAPPER, code, limit);
    }

    /** 按主键 id 查询单条新闻（feed 与个股新闻、公告均在此表）。无匹配返回 null。 */
    public NewsRow queryById(Long id) {
        if (id == null || id <= 0) return null;
        List<NewsRow> rows = jdbcTemplate.query("""
                SELECT id, stock_code, title, summary, url, source,
                       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
                FROM news_feed WHERE id = ?
                """, MAPPER, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * 通用新闻 feed 分页查询（stock_code 为空串：新浪 feed + RSS 来源）。
     * 按 published_at 倒序，limit 为每页条数、offset 为偏移。
     * id 大于 0 时追加 id <= ? 过滤（按 id 上限截取，用于滑动分页/增量拉取）。
     */
    public List<NewsRow> queryFeed(int limit, int offset, Long id) {
        if (limit <= 0) limit = 20;
        if (offset < 0) offset = 0;
        String sql = """
                SELECT id, stock_code, title, summary, url, source,
                       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
                FROM news_feed WHERE stock_code = ''
                """;
        boolean filterById = id != null && id > 0;
        List<Object> args = new ArrayList<>();
        if (filterById) {
            sql += " AND id <= ?";
            args.add(id);
        }
        sql += " ORDER BY published_at DESC LIMIT ? OFFSET ?";
        args.add(limit);
        args.add(offset);
        return jdbcTemplate.query(sql, MAPPER, args.toArray());
    }
}
