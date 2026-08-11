package com.guyu.stock.dao;

import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.model.QuoteSnapshot;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

@Repository
public class YahooQuoteRepository {

    private final JdbcTemplate jdbcTemplate;

    public YahooQuoteRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 按主键 code upsert（覆盖式，仅存最新快照）。
     * 与 StockKlineRepository.batchUpsert 同一约定：先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING，
     * H2 测试库与生产 PostgreSQL 均兼容。
     */
    public void upsert(List<QuoteSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return;
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        for (QuoteSnapshot s : snapshots) {
            int updated = jdbcTemplate.update("""
                    UPDATE quote_snapshot SET name=?, price=?, pct_change=?, updated_at=? WHERE code=?
                    """, s.name(), s.price(), s.pctChange(), now, s.code());
            if (updated == 0) {
                jdbcTemplate.update("""
                        INSERT INTO quote_snapshot (code, name, price, pct_change, updated_at)
                        VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING
                        """, s.code(), s.name(), s.price(), s.pctChange(), now);
            }
        }
    }

    /** 指数列表：stock_info(type=index) 为主，LEFT JOIN quote_snapshot 拿实时点位；快照未刷时 price 为 null */
    public List<IndexQuote> queryIndexList() {
        return jdbcTemplate.query("""
                SELECT s.code, s.name, s.market, q.price, q.pct_change, q.updated_at
                FROM stock_info s
                LEFT JOIN quote_snapshot q ON q.code = s.code
                WHERE s.type = 'index' AND s.is_active = true
                ORDER BY s.market, s.code
                """,
                (rs, i) -> new IndexQuote(
                        rs.getString("code"),
                        rs.getString("name"),
                        rs.getString("market"),
                        toDouble(rs.getObject("price")),
                        toDouble(rs.getObject("pct_change")),
                        rs.getTimestamp("updated_at") != null
                                ? rs.getTimestamp("updated_at").toLocalDateTime()
                                : null));
    }

    private static Double toDouble(Object v) {
        return v == null ? null : ((Number) v).doubleValue();
    }
}
