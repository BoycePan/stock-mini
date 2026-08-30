package com.guyu.stock.dao;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * click_event 过期清理（TrackRepository#deleteBefore）H2 集成测试：
 * 验证「server_ts 早于 cutoff」的记录被删、其余保留，且 SQL 兼容 H2（MODE=PostgreSQL）。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class TrackRepositoryCleanupTest {

    @Autowired
    private TrackRepository trackRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private void insert(String eventId, LocalDateTime serverTs) {
        jdbcTemplate.update("""
                INSERT INTO click_event (event_id, event_name, server_ts)
                VALUES (?, ?, ?)
                """, eventId, "test.event", Timestamp.valueOf(serverTs));
    }

    private int countByEventIds(String... ids) {
        String in = String.join(",", java.util.Collections.nCopies(ids.length, "?"));
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM click_event WHERE event_id IN (" + in + ")",
                Integer.class, (Object[]) ids);
        return n == null ? 0 : n;
    }

    @Test
    void deleteBeforeRemovesOnlyOldRecords() {
        LocalDateTime now = LocalDateTime.now();
        insert("old-6d", now.minusDays(6));
        insert("old-8d", now.minusDays(8));
        insert("new-1d", now.minusDays(1));
        insert("new-today", now);

        int deleted = trackRepository.deleteBefore(now.minusDays(5));

        assertEquals(2, deleted, "应删除 6 天/8 天前的记录");
        assertEquals(0, countByEventIds("old-6d", "old-8d"));
        assertEquals(2, countByEventIds("new-1d", "new-today"));
    }

    @Test
    void deleteBeforeCutoffBoundaryKeepsExactCutoff() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime cutoff = now.minusDays(5);
        insert("boundary-old", cutoff.minusSeconds(1));   // 严格早于 cutoff → 删
        insert("boundary-eq", cutoff);                    // 恰等于 cutoff → 保留
        insert("boundary-new", cutoff.plusSeconds(1));    // 晚于 cutoff → 保留

        int deleted = trackRepository.deleteBefore(cutoff);

        assertEquals(1, deleted);
        List<String> remain = jdbcTemplate.queryForList(
                "SELECT event_id FROM click_event ORDER BY event_id", String.class);
        assertEquals(List.of("boundary-eq", "boundary-new"), remain);
    }

    @Test
    void deleteBeforeNullIsNoOp() {
        insert("keep", LocalDateTime.now());
        assertEquals(0, trackRepository.deleteBefore(null));
        assertEquals(1, countByEventIds("keep"));
    }
}
