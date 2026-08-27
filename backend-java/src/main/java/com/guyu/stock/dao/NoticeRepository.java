package com.guyu.stock.dao;

import com.guyu.stock.model.Notice;
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
 * 前端公告内容（notice 表）。管理后台 /api/mgr/notices 增删改；
 * 公开接口 findEnabledForDisplay() 按分端 + 位置 + 有效期读取。
 */
@Repository
public class NoticeRepository {

    private final JdbcTemplate jdbcTemplate;

    public NoticeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<Notice> MAPPER = (rs, i) -> new Notice(
            rs.getLong("id"), rs.getString("type"), rs.getString("title"), rs.getString("target"),
            rs.getString("position"), rs.getInt("sort"), rs.getBoolean("pinned"),
            rs.getBoolean("enabled"), rs.getTimestamp("valid_from"), rs.getTimestamp("valid_to"),
            rs.getString("config"), rs.getTimestamp("created_at"), rs.getTimestamp("updated_at"));

    private static final String COLS =
            "id, type, title, target, position, sort, pinned, enabled, valid_from, valid_to, config, created_at, updated_at";

    /** 全量（管理后台列表）：先置顶，再按 sort 升序、id 倒序兜底 */
    public List<Notice> findAll() {
        return jdbcTemplate.query("""
                SELECT %s FROM notice
                ORDER BY pinned DESC, sort ASC, id DESC
                """.formatted(COLS), MAPPER);
    }

    public Optional<Notice> findById(long id) {
        List<Notice> rows = jdbcTemplate.query(
                "SELECT " + COLS + " FROM notice WHERE id = ?", MAPPER, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * 公开读取：启用的、命中分端（all 兜底 + 指定端）、展示位置匹配、
     * 当前时间在有效期内（valid_from/valid_to 可空）的公告。
     * 排序：先置顶，再按 sort 升序、创建时间倒序兜底。
     */
    public List<Notice> findEnabledForDisplay(String target, String position) {
        return jdbcTemplate.query("""
                SELECT %s FROM notice
                WHERE enabled = TRUE
                  AND (target = ? OR target = 'all')
                  AND position = ?
                  AND (valid_from IS NULL OR valid_from <= now())
                  AND (valid_to IS NULL OR valid_to >= now())
                ORDER BY pinned DESC, sort ASC, created_at DESC
                """.formatted(COLS), MAPPER, target, position);
    }

    /** 公开读取（不限定位置）：命中分端 + 当前有效的全部公告 */
    public List<Notice> findEnabledForTarget(String target) {
        return jdbcTemplate.query("""
                SELECT %s FROM notice
                WHERE enabled = TRUE
                  AND (target = ? OR target = 'all')
                  AND (valid_from IS NULL OR valid_from <= now())
                  AND (valid_to IS NULL OR valid_to >= now())
                ORDER BY pinned DESC, sort ASC, created_at DESC
                """.formatted(COLS), MAPPER, target);
    }

    /** 新增，返回自增主键 id */
    public long insert(String type, String title, String target, String position, int sort,
                       boolean pinned, boolean enabled, Timestamp validFrom, Timestamp validTo, String config) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO notice (type, title, target, position, sort, pinned, enabled, valid_from, valid_to, config) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    new String[] { "id" });
            ps.setString(1, type);
            ps.setString(2, title);
            ps.setString(3, target);
            ps.setString(4, position);
            ps.setInt(5, sort);
            ps.setBoolean(6, pinned);
            ps.setBoolean(7, enabled);
            ps.setTimestamp(8, validFrom);
            ps.setTimestamp(9, validTo);
            ps.setString(10, config);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        return key == null ? 0 : key.longValue();
    }

    /**
     * 动态更新：只更新传入的非 null 字段；返回受影响行数（0 表示 id 不存在）。
     * validFrom/validTo 用 {code xxxChanged} 标记是否更新（可置 NULL 以清除有效期）。
     */
    public int update(long id, String type, String title, String target, String position,
                      Integer sort, Boolean pinned, Boolean enabled,
                      Timestamp validFrom, boolean validFromChanged,
                      Timestamp validTo, boolean validToChanged,
                      String config) {
        StringBuilder sql = new StringBuilder("UPDATE notice SET ");
        List<Object> args = new ArrayList<>();
        if (type != null) { sql.append("type = ?, "); args.add(type); }
        if (title != null) { sql.append("title = ?, "); args.add(title); }
        if (target != null) { sql.append("target = ?, "); args.add(target); }
        if (position != null) { sql.append("position = ?, "); args.add(position); }
        if (sort != null) { sql.append("sort = ?, "); args.add(sort); }
        if (pinned != null) { sql.append("pinned = ?, "); args.add(pinned); }
        if (enabled != null) { sql.append("enabled = ?, "); args.add(enabled); }
        if (validFromChanged) { sql.append("valid_from = ?, "); args.add(validFrom); }
        if (validToChanged) { sql.append("valid_to = ?, "); args.add(validTo); }
        if (config != null) { sql.append("config = ?, "); args.add(config); }
        sql.append("updated_at = now(), ");
        if (args.isEmpty()) return 0;
        sql.setLength(sql.length() - 2);
        sql.append(" WHERE id = ?");
        args.add(id);
        return jdbcTemplate.update(sql.toString(), args.toArray());
    }

    public int delete(long id) {
        return jdbcTemplate.update("DELETE FROM notice WHERE id = ?", id);
    }
}
