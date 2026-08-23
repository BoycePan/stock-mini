package com.guyu.stock.dao;

import com.guyu.stock.model.ClickEvent;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

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
}
