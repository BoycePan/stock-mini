package com.guyu.stock.dao;

import com.guyu.stock.model.StockKline;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
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
            rs.getDouble("amplitude"),
            rs.getString("type")
    );

    public List<StockKline> queryByCode(String code, String scale, int limit) {
        return jdbcTemplate.query(
                "SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT ?",
                MAPPER, code, scale, limit);
    }

    /** 查询某 code 的 K 线（since 为空则全部），按交易日期升序；供 index K线按 range 过滤。 */
    public List<StockKline> queryByCodeSince(String code, String scale, LocalDate since) {
        if (since == null) {
            return jdbcTemplate.query(
                    "SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date ASC",
                    MAPPER, code, scale);
        }
        return jdbcTemplate.query(
                "SELECT * FROM stock_kline WHERE code=? AND scale=? AND trade_date>=? ORDER BY trade_date ASC",
                MAPPER, code, scale, java.sql.Date.valueOf(since));
    }

    public LocalDate getLatestDate(String code, String scale) {
        List<LocalDate> dates = jdbcTemplate.query(
                "SELECT trade_date FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT 1",
                (rs, i) -> rs.getDate(1).toLocalDate(), code, scale);
        return dates.isEmpty() ? null : dates.get(0);
    }

    /**
     * 按主键 (code, scale, trade_date) 批量 upsert，对齐 Go stock_kline.go 的 BatchUpsert 语义。
     *
     * 注意：H2(2.2.224/2.3.232) 即使 MODE=PostgreSQL 也无法执行 PostgreSQL 的
     * ON CONFLICT (code, scale, trade_date) DO UPDATE SET ... EXCLUDED（C 阶段 Task 7 已验证），
     * 故用「先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING」实现同样的按主键 upsert 语义
     * （H2 测试库与生产 PostgreSQL 均兼容，与 ConceptRepository.upsertBoard 同一约定）。
     */
    public void batchUpsert(List<StockKline> klines) {
        if (klines == null || klines.isEmpty()) return;
        for (StockKline k : klines) {
            Timestamp now = Timestamp.valueOf(LocalDateTime.now());
            int updated = jdbcTemplate.update("""
                    UPDATE stock_kline SET
                        open=?, high=?, low=?, close=?, volume=?, amount=?, turnover=?,
                        pct_change=?, change_amt=?, amplitude=?, type=?, created_at=?
                    WHERE code=? AND scale=? AND trade_date=?
                    """,
                    k.open(), k.high(), k.low(), k.close(), k.volume(), k.amount(), k.turnover(),
                    k.pctChange(), k.changeAmt(), k.amplitude(), k.type(), now,
                    k.code(), k.scale(), java.sql.Date.valueOf(k.tradeDate()));
            if (updated == 0) {
                jdbcTemplate.update("""
                        INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount, turnover, pct_change, change_amt, amplitude, type, created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT DO NOTHING
                        """,
                        k.code(), k.scale(), java.sql.Date.valueOf(k.tradeDate()), k.open(), k.high(), k.low(), k.close(),
                        k.volume(), k.amount(), k.turnover(), k.pctChange(), k.changeAmt(), k.amplitude(), k.type(), now);
            }
        }
    }
}
