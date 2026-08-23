package com.guyu.stock.dao;

import com.guyu.stock.model.RssSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

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
            rs.getLong("id"), rs.getString("name"), rs.getString("url"), rs.getBoolean("via_worker"),
            rs.getBoolean("enabled"), rs.getBoolean("deleted"), rs.getString("last_status"),
            rs.getString("last_error"), rs.getTimestamp("last_fetch_at"),
            rs.getObject("last_item_count") == null ? null : rs.getInt("last_item_count"));

    private static final String COLS = "id, name, url, via_worker, enabled, deleted, last_status, last_error, last_fetch_at, last_item_count";

    /** 启用的源（未软删），按 id 升序（稳定的拉取顺序） */
    public List<RssSource> findEnabled() {
        return jdbcTemplate.query("""
                SELECT %s FROM rss_source
                WHERE enabled = TRUE AND deleted = FALSE ORDER BY id
                """.formatted(COLS), MAPPER);
    }

    /** 管理后台列表：includeDeleted=true 时包含软删源，否则排除 */
    public List<RssSource> findAll(boolean includeDeleted) {
        String sql = "SELECT " + COLS + " FROM rss_source";
        if (!includeDeleted) sql += " WHERE deleted = FALSE";
        sql += " ORDER BY id";
        return jdbcTemplate.query(sql, MAPPER);
    }

    public Optional<RssSource> findById(long id) {
        List<RssSource> rows = jdbcTemplate.query(
                "SELECT " + COLS + " FROM rss_source WHERE id = ?", MAPPER, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
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

    /** 新增源，返回自增主键 id */
    public long insert(String name, String url, boolean viaWorker, boolean enabled) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            // 显式指定只返回 id 列：PostgreSQL 的 RETURN_GENERATED_KEYS 会返回整行，
            // 若不限定列，keyHolder.getKey() 因拿到多列而抛 InvalidDataAccessApiUsageException。
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO rss_source (name, url, via_worker, enabled) VALUES (?,?,?,?)",
                    new String[] { "id" });
            ps.setString(1, name);
            ps.setString(2, url);
            ps.setBoolean(3, viaWorker);
            ps.setBoolean(4, enabled);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        return key == null ? 0 : key.longValue();
    }

    /**
     * 动态更新：只更新传入的非 null 字段。
     * 覆盖 name/url/via_worker/enabled/deleted，用于修改信息、启停、软删、恢复。
     * 返回受影响行数（0 表示 id 不存在）。
     */
    public int update(long id, String name, String url, Boolean viaWorker, Boolean enabled, Boolean deleted) {
        StringBuilder sql = new StringBuilder("UPDATE rss_source SET ");
        List<Object> args = new ArrayList<>();
        if (name != null) { sql.append("name = ?, "); args.add(name); }
        if (url != null) { sql.append("url = ?, "); args.add(url); }
        if (viaWorker != null) { sql.append("via_worker = ?, "); args.add(viaWorker); }
        if (enabled != null) { sql.append("enabled = ?, "); args.add(enabled); }
        if (deleted != null) { sql.append("deleted = ?, "); args.add(deleted); }
        if (args.isEmpty()) return 0;
        sql.setLength(sql.length() - 2); // 去掉末尾 ", "
        sql.append(" WHERE id = ?");
        args.add(id);
        return jdbcTemplate.update(sql.toString(), args.toArray());
    }

    /** 回写最近一次拉取状态（定时任务与手动 check 共用） */
    public void updateStatus(long id, String status, String error, Timestamp fetchAt, int itemCount) {
        jdbcTemplate.update("""
                UPDATE rss_source SET last_status = ?, last_error = ?, last_fetch_at = ?, last_item_count = ?
                WHERE id = ?
                """, status, error, fetchAt, itemCount, id);
    }
}
