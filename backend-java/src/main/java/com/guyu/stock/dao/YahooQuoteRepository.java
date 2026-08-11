package com.guyu.stock.dao;

import com.guyu.stock.common.util.TradingHours;
import com.guyu.stock.model.AssetQuote;
import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.SectorQuote;
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
                SELECT s.code, s.name, s.market, s.trading_hours, q.price, q.pct_change, q.updated_at
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
                                : null,
                        rs.getString("trading_hours"),
                        TradingHours.isTrading("index", rs.getString("market"))));
    }

    /** 查询单个指数最新实时快照；无记录返回 null。 */
    public QuoteSnapshot findByCode(String code) {
        List<QuoteSnapshot> rows = jdbcTemplate.query("""
                SELECT code, name, price, pct_change, updated_at FROM quote_snapshot WHERE code=?
                """,
                (rs, i) -> new QuoteSnapshot(
                        rs.getString("code"),
                        rs.getString("name"),
                        rs.getDouble("price"),
                        rs.getDouble("pct_change"),
                        rs.getTimestamp("updated_at") != null
                                ? rs.getTimestamp("updated_at").toLocalDateTime()
                                : null),
                code);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static final org.springframework.jdbc.core.RowMapper<SectorQuote> SECTOR_MAPPER = (rs, i) -> new SectorQuote(
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("market"),
            rs.getString("board"),
            toDouble(rs.getObject("price")),
            toDouble(rs.getObject("pct_change")),
            rs.getTimestamp("updated_at") != null
                    ? rs.getTimestamp("updated_at").toLocalDateTime()
                    : null,
            rs.getString("trading_hours"),
            TradingHours.isTrading("sector", rs.getString("market")));

    private static final org.springframework.jdbc.core.RowMapper<AssetQuote> ASSET_MAPPER = (rs, i) -> new AssetQuote(
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("type"),
            rs.getString("market"),
            rs.getString("board"),
            toDouble(rs.getObject("price")),
            toDouble(rs.getObject("pct_change")),
            rs.getTimestamp("updated_at") != null
                    ? rs.getTimestamp("updated_at").toLocalDateTime()
                    : null,
            rs.getString("trading_hours"),
            TradingHours.isTrading(rs.getString("type"), rs.getString("market")));

    /** 全球资产列表（商品/外汇/加密）：按 type 必查、market 可选过滤；含 type/market/board 供前端分组 */
    public List<AssetQuote> queryAssetList(String type, String market) {
        if (market == null || market.isBlank()) {
            return jdbcTemplate.query("""
                    SELECT s.code, s.name, s.type, s.market, s.board, s.trading_hours, q.price, q.pct_change, q.updated_at
                    FROM stock_info s
                    LEFT JOIN quote_snapshot q ON q.code = s.code
                    WHERE s.type = ? AND s.is_active = true
                    ORDER BY s.market, s.board, s.code
                    """, ASSET_MAPPER, type);
        }
        return jdbcTemplate.query("""
                SELECT s.code, s.name, s.type, s.market, s.board, s.trading_hours, q.price, q.pct_change, q.updated_at
                FROM stock_info s
                LEFT JOIN quote_snapshot q ON q.code = s.code
                WHERE s.type = ? AND s.is_active = true AND s.market = ?
                ORDER BY s.market, s.board, s.code
                """, ASSET_MAPPER, type, market);
    }

    /** 板块列表：stock_info(type=sector) 为主，LEFT JOIN quote_snapshot 拿实时点位；market 为空返回全部，否则按市场过滤；按 market/board/code 排序 */
    public List<SectorQuote> querySectorList(String market) {
        if (market == null || market.isBlank()) {
            return jdbcTemplate.query("""
                    SELECT s.code, s.name, s.market, s.board, s.trading_hours, q.price, q.pct_change, q.updated_at
                    FROM stock_info s
                    LEFT JOIN quote_snapshot q ON q.code = s.code
                    WHERE s.type = 'sector' AND s.is_active = true
                    ORDER BY s.market, s.board, s.code
                    """, SECTOR_MAPPER);
        }
        return jdbcTemplate.query("""
                SELECT s.code, s.name, s.market, s.board, s.trading_hours, q.price, q.pct_change, q.updated_at
                FROM stock_info s
                LEFT JOIN quote_snapshot q ON q.code = s.code
                WHERE s.type = 'sector' AND s.is_active = true AND s.market = ?
                ORDER BY s.market, s.board, s.code
                """, SECTOR_MAPPER, market);
    }

    private static Double toDouble(Object v) {
        return v == null ? null : ((Number) v).doubleValue();
    }
}
