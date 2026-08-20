package com.guyu.stock.dao;

import com.guyu.stock.model.RssSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * RSS 新闻源配置（rss_source 表）。源列表走数据库：增删改源无需改配置/重启，
 * 定时任务每分钟调用 findEnabled() 读取。
 */
@Repository
public class RssSourceRepository {

    private final JdbcTemplate jdbcTemplate;

    public RssSourceRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<RssSource> MAPPER = (rs, i) -> new RssSource(
            rs.getLong("id"), rs.getString("name"), rs.getString("url"), rs.getBoolean("via_worker"));

    /** 启用的源，按 id 升序（稳定的拉取顺序） */
    public List<RssSource> findEnabled() {
        return jdbcTemplate.query("""
                SELECT id, name, url, via_worker FROM rss_source
                WHERE enabled = TRUE ORDER BY id
                """, MAPPER);
    }

    public long count() {
        Long n = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rss_source", Long.class);
        return n == null ? 0 : n;
    }

    /** 幂等写入（url 唯一冲突跳过），用于启动时默认源种子 */
    public void insertIfAbsent(String name, String url, boolean viaWorker) {
        jdbcTemplate.update("""
                INSERT INTO rss_source (name, url, via_worker) VALUES (?,?,?)
                ON CONFLICT DO NOTHING
                """, name, url, viaWorker);
    }
}
