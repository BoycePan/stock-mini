package com.guyu.stock.stock;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class StockInfoRepository {

    private final JdbcTemplate jdbcTemplate;

    public StockInfoRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<StockInfo> MAPPER = (rs, i) -> new StockInfo(
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("type"),
            rs.getString("market"),
            rs.getString("board"),
            rs.getString("industry"),
            rs.getBoolean("is_active"),
            rs.getTimestamp("updated_at") != null ? rs.getTimestamp("updated_at").toLocalDateTime() : null
    );

    public List<StockInfo> search(String keyword, int limit) {
        if (limit <= 0) limit = 20;
        return jdbcTemplate.query("""
                SELECT * FROM stock_info
                WHERE is_active = true
                  AND (code = ? OR code LIKE ? OR name LIKE ? OR name LIKE ?)
                ORDER BY
                    CASE
                        WHEN code = ? THEN 1
                        WHEN name LIKE ? THEN 2
                        WHEN code LIKE ? THEN 3
                        ELSE 4
                    END,
                    code
                LIMIT ?
                """, MAPPER,
                keyword, keyword + "%", keyword + "%", "%" + keyword + "%",
                keyword, keyword + "%", keyword + "%", limit);
    }
}
