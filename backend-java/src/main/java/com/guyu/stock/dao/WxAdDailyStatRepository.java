package com.guyu.stock.dao;

import com.guyu.stock.model.WxAdDailyStat;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 微信广告日统计（wx_ad_daily_stat 表）。
 *
 * <p>一行 = target(端) × ad_slot(广告位类型) × stat_date(统计日)，按
 * {@code (target, stat_date, ad_slot)} 唯一索引幂等 upsert，实现「数据覆盖」：
 * 同一天重复拉取（微信侧数据有延时/修正）时覆盖为最新值。</p>
 *
 * <p>与 StockKlineRepository.batchUpsert 同一约定：H2 测试库无法执行 PostgreSQL 的
 * ON CONFLICT ... DO UPDATE ... EXCLUDED，故用「先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING」。</p>
 */
@Repository
public class WxAdDailyStatRepository {

    private final JdbcTemplate jdbcTemplate;

    public WxAdDailyStatRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<WxAdDailyStat> MAPPER = (rs, i) -> new WxAdDailyStat(
            rs.getLong("id"),
            rs.getString("target"),
            rs.getDate("stat_date"),
            (Long) rs.getObject("slot_id"),
            rs.getString("ad_slot"),
            rs.getString("ad_slot_name"),
            rs.getLong("req_succ_count"),
            rs.getLong("exposure_count"),
            rs.getBigDecimal("exposure_rate"),
            rs.getLong("click_count"),
            rs.getBigDecimal("click_rate"),
            rs.getLong("income_fen"),
            rs.getBigDecimal("ecpm_fen"),
            rs.getTimestamp("pulled_at"),
            rs.getTimestamp("created_at"));

    private static final String COLS =
            "id, target, stat_date, slot_id, ad_slot, ad_slot_name, req_succ_count, exposure_count, "
            + "exposure_rate, click_count, click_rate, income_fen, ecpm_fen, pulled_at, created_at";

    /**
     * 管理端查询：按端 + 日期区间 + 可选广告位类型过滤，按统计日降序。
     * target 为空 = 全部端；adSlot 为空 = 全部广告位类型。
     */
    public List<WxAdDailyStat> query(String target, LocalDate from, LocalDate to, String adSlot) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(" FROM wx_ad_daily_stat WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (target != null && !target.isBlank()) {
            sql.append(" AND target = ?");
            args.add(target.trim());
        }
        if (from != null) {
            sql.append(" AND stat_date >= ?");
            args.add(Date.valueOf(from));
        }
        if (to != null) {
            sql.append(" AND stat_date <= ?");
            args.add(Date.valueOf(to));
        }
        if (adSlot != null && !adSlot.isBlank()) {
            sql.append(" AND ad_slot = ?");
            args.add(adSlot.trim());
        }
        sql.append(" ORDER BY stat_date DESC, ad_slot ASC, id DESC");
        return jdbcTemplate.query(sql.toString(), MAPPER, args.toArray());
    }

    /**
     * 批量 upsert，返回实际写入（更新 + 新插入）行数。
     * 唯一键 (target, stat_date, ad_slot)：先尝试 UPDATE，命中则覆盖；未命中再 INSERT。
     */
    public int batchUpsert(List<WxAdDailyStat> rows) {
        if (rows == null || rows.isEmpty()) return 0;
        int written = 0;
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        for (WxAdDailyStat r : rows) {
            int updated = jdbcTemplate.update("""
                    UPDATE wx_ad_daily_stat SET
                        slot_id=?, ad_slot_name=?, req_succ_count=?, exposure_count=?, exposure_rate=?,
                        click_count=?, click_rate=?, income_fen=?, ecpm_fen=?, pulled_at=?
                    WHERE target=? AND stat_date=? AND ad_slot=?
                    """,
                    r.slotId(), r.adSlotName(), r.reqSuccCount(), r.exposureCount(), r.exposureRate(),
                    r.clickCount(), r.clickRate(), r.incomeFen(), r.ecpmFen(), now,
                    r.target(), r.statDate(), r.adSlot());
            if (updated == 0) {
                jdbcTemplate.update("""
                        INSERT INTO wx_ad_daily_stat
                            (target, stat_date, slot_id, ad_slot, ad_slot_name, req_succ_count, exposure_count,
                             exposure_rate, click_count, click_rate, income_fen, ecpm_fen, pulled_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT DO NOTHING
                        """,
                        r.target(), r.statDate(), r.slotId(), r.adSlot(), r.adSlotName(), r.reqSuccCount(),
                        r.exposureCount(), r.exposureRate(), r.clickCount(), r.clickRate(), r.incomeFen(),
                        r.ecpmFen(), now);
            }
            written++;
        }
        return written;
    }
}
