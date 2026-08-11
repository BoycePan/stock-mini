package com.guyu.stock.dao;

import com.guyu.stock.model.StockInfo;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
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

    /**
     * 单独补写某资产的交易时段（stock_info.trading_hours，北京时间，如 "21:30-04:00"）。
     * 雅虎指数/板块/资产元数据登记后调用；tradingHours 为 null 时跳过（如未知市场）。
     */
    public void updateTradingHours(String code, String tradingHours) {
        if (tradingHours == null || code == null) return;
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        jdbcTemplate.update("UPDATE stock_info SET trading_hours=?, updated_at=? WHERE code=?",
                tradingHours, now, code);
    }

    /** 活跃股票数量，对齐 Go CountActiveStocks，供启动自检判断是否为空库。 */
    public int count() {
        Integer n = jdbcTemplate.queryForObject("SELECT count(*) FROM stock_info WHERE is_active=true", Integer.class);
        return n == null ? 0 : n;
    }

    /**
     * 按主键 code 批量 upsert，对齐 Go stock_info.go 的 BatchUpsert 语义。
     *
     * 注意：H2(2.2.224/2.3.232) 即使 MODE=PostgreSQL 也无法执行 PostgreSQL 的
     * ON CONFLICT (code) DO UPDATE SET ... EXCLUDED（C 阶段 Task 7/9 已验证），
     * 故用「先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING」实现同样的按主键 upsert 语义
     * （H2 测试库与生产 PostgreSQL 均兼容，与 StockKlineRepository.batchUpsert/ConceptRepository.upsertBoard 同一约定）。
     * type/is_active 取自传入实体：A股采集传 "stock"/true，雅虎指数元数据传 "index"/true。
     */
    public void batchUpsert(List<StockInfo> infos) {
        if (infos == null || infos.isEmpty()) return;
        for (StockInfo info : infos) {
            Timestamp now = Timestamp.valueOf(LocalDateTime.now());
            int updated = jdbcTemplate.update("""
                    UPDATE stock_info SET
                        name=?, type=?, market=?, board=?, industry=?, is_active=?, updated_at=?
                    WHERE code=?
                    """,
                    info.name(), info.type(), info.market(), info.board(), info.industry(),
                    info.isActive(), now, info.code());
            if (updated == 0) {
                jdbcTemplate.update("""
                        INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at)
                        VALUES (?,?,?,?,?,?,?,?)
                        ON CONFLICT DO NOTHING
                        """,
                        info.code(), info.name(), info.type(), info.market(), info.board(), info.industry(),
                        info.isActive(), now);
            }
        }
    }
}
