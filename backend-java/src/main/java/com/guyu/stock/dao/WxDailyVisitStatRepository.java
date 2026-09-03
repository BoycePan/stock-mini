package com.guyu.stock.dao;

import com.guyu.stock.model.WxDailyVisitStat;
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
 * 微信小程序访问趋势日统计（wx_daily_visit_stat 表）。
 *
 * <p>按 {@code (target, stat_date)} 唯一索引幂等 upsert（与 WxAdDailyStatRepository 同一约定：
 * 先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING，兼容 H2 测试库与生产 PostgreSQL）。</p>
 */
@Repository
public class WxDailyVisitStatRepository {

    private final JdbcTemplate jdbcTemplate;

    public WxDailyVisitStatRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<WxDailyVisitStat> MAPPER = (rs, i) -> new WxDailyVisitStat(
            rs.getLong("id"),
            rs.getString("target"),
            rs.getDate("stat_date"),
            rs.getLong("session_cnt"),
            rs.getLong("visit_pv"),
            rs.getLong("visit_uv"),
            rs.getLong("visit_uv_new"),
            (Double) rs.getObject("stay_time_uv"),
            (Double) rs.getObject("stay_time_session"),
            (Double) rs.getObject("visit_depth"),
            rs.getTimestamp("pulled_at"),
            rs.getTimestamp("created_at"));

    private static final String COLS =
            "id, target, stat_date, session_cnt, visit_pv, visit_uv, visit_uv_new, "
            + "stay_time_uv, stay_time_session, visit_depth, pulled_at, created_at";

    /** 批量 upsert（通常单行），返回写入行数 */
    public int batchUpsert(List<WxDailyVisitStat> rows) {
        if (rows == null || rows.isEmpty()) return 0;
        int written = 0;
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        for (WxDailyVisitStat r : rows) {
            int updated = jdbcTemplate.update("""
                    UPDATE wx_daily_visit_stat SET
                        session_cnt=?, visit_pv=?, visit_uv=?, visit_uv_new=?,
                        stay_time_uv=?, stay_time_session=?, visit_depth=?, pulled_at=?
                    WHERE target=? AND stat_date=?
                    """,
                    r.sessionCnt(), r.visitPv(), r.visitUv(), r.visitUvNew(),
                    r.stayTimeUv(), r.stayTimeSession(), r.visitDepth(), now,
                    r.target(), r.statDate());
            if (updated == 0) {
                jdbcTemplate.update("""
                        INSERT INTO wx_daily_visit_stat
                            (target, stat_date, session_cnt, visit_pv, visit_uv, visit_uv_new,
                             stay_time_uv, stay_time_session, visit_depth, pulled_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT DO NOTHING
                        """,
                        r.target(), r.statDate(), r.sessionCnt(), r.visitPv(), r.visitUv(), r.visitUvNew(),
                        r.stayTimeUv(), r.stayTimeSession(), r.visitDepth(), now);
            }
            written++;
        }
        return written;
    }

    /** 管理端查询：按端 + 日期区间，按统计日降序 */
    public List<WxDailyVisitStat> query(String target, LocalDate from, LocalDate to) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(" FROM wx_daily_visit_stat WHERE 1=1");
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
        sql.append(" ORDER BY stat_date DESC");
        return jdbcTemplate.query(sql.toString(), MAPPER, args.toArray());
    }
}
