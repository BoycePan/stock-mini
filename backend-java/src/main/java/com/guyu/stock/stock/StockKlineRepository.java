package com.guyu.stock.stock;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class StockKlineRepository {

    private final JdbcTemplate jdbcTemplate;

    public StockKlineRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<StockKline> MAPPER = (rs, i) -> new StockKline(
            rs.getString("code"),
            rs.getString("scale"),
            rs.getDate("trade_date").toLocalDate(),
            rs.getDouble("open"),
            rs.getDouble("high"),
            rs.getDouble("low"),
            rs.getDouble("close"),
            rs.getLong("volume"),
            rs.getDouble("amount"),
            rs.getDouble("turnover"),
            rs.getDouble("pct_change"),
            rs.getDouble("change_amt"),
            rs.getDouble("amplitude")
    );

    public List<StockKline> queryByCode(String code, String scale, int limit) {
        return jdbcTemplate.query(
                "SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT ?",
                MAPPER, code, scale, limit);
    }

    public LocalDate getLatestDate(String code, String scale) {
        List<LocalDate> dates = jdbcTemplate.query(
                "SELECT trade_date FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT 1",
                (rs, i) -> rs.getDate(1).toLocalDate(), code, scale);
        return dates.isEmpty() ? null : dates.get(0);
    }
}
