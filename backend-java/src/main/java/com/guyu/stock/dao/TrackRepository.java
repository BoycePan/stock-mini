package com.guyu.stock.dao;

import com.guyu.stock.model.ClickEvent;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 用户行为事件落库（click_event 表）。
 *
 * <p>幂等语义：{@code event_id} 唯一索引 + {@code ON CONFLICT (event_id) DO NOTHING}，
 * 客户端断网重试 / 重复上报时静默跳过，不会重复计数（与 NewsRepository.batchSave 的
 * 去重思路一致）。逐条执行（每条一次绑定），批量体量（&le;100）下开销可控。
 */
@Repository
public class TrackRepository {

    private final JdbcTemplate jdbcTemplate;

    public TrackRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 批量落库，返回实际新插入条数（冲突跳过的记录不计入）。
     * 服务端接收时间 server_ts 由数据库 DEFAULT now() 生成。
     */
    public int batchInsert(List<ClickEvent> events) {
        if (events == null || events.isEmpty()) return 0;
        int inserted = 0;
        for (ClickEvent e : events) {
            inserted += jdbcTemplate.update("""
                    INSERT INTO click_event
                        (event_id, user_id, session_id, event_type, event_name, page, target, props,
                         duration_ms, client_ts, ip, platform, app_version)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT (event_id) DO NOTHING
                    """,
                    e.eventId(), e.userId(), e.sessionId(), e.eventType(), e.eventName(),
                    e.page(), e.target(), e.props(), e.durationMs(), e.clientTs(),
                    e.ip(), e.platform(), e.appVersion());
        }
        return inserted;
    }

    /**
     * 删除 {@code server_ts} 早于 {@code cutoff} 的过期记录（按服务端接收时间清理）。
     *
     * <p>分批删除（每批 {@link #DELETE_BATCH_SIZE} 行）防止大表一次 DELETE 锁表过久 /
     * 事务日志膨胀；返回实际删除总行数。数据库时区由应用启动时钉死东8区（见 StockApplication）。
     */
    public int deleteBefore(LocalDateTime cutoff) {
        if (cutoff == null) return 0;
        Timestamp bound = Timestamp.valueOf(cutoff);
        int total = 0;
        while (true) {
            int n = jdbcTemplate.update("""
                    DELETE FROM click_event
                    WHERE id IN (SELECT id FROM click_event WHERE server_ts < ? ORDER BY id LIMIT ?)
                    """, bound, DELETE_BATCH_SIZE);
            total += n;
            if (n < DELETE_BATCH_SIZE) break;
        }
        return total;
    }

    /** 单批删除上限：防止单条 DELETE 扫太多行、锁表时间过长（与批量落库上限独立） */
    private static final int DELETE_BATCH_SIZE = 5000;
}
