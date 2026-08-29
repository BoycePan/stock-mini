package com.guyu.stock.dao;

import com.guyu.stock.model.AppConfig;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 前端展示配置（app_config 表）。配置走数据库：管理后台 /api/mgr/configs 增删改，
 * 登录下发与 /api/v1/configs 读取共用 findEnabledByTypeAndTarget()。
 */
@Repository
public class AppConfigRepository {

    private final JdbcTemplate jdbcTemplate;

    public AppConfigRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<AppConfig> MAPPER = (rs, i) -> new AppConfig(
            rs.getLong("id"),
            rs.getObject("parent_id") == null ? null : rs.getLong("parent_id"),
            rs.getString("node_type"), rs.getString("cfg_type"), rs.getString("cfg_key"),
            rs.getString("cfg_value"), rs.getString("remark"), rs.getString("target"),
            rs.getInt("sort"), rs.getBoolean("enabled"), rs.getTimestamp("updated_at"));

    private static final String COLS =
            "id, parent_id, node_type, cfg_type, cfg_key, cfg_value, remark, target, sort, enabled, updated_at";

    /** 全量（管理后台列表）：按 sort 升序、id 升序 */
    public List<AppConfig> findAll() {
        return jdbcTemplate.query("SELECT " + COLS + " FROM app_config ORDER BY sort, id", MAPPER);
    }

    public Optional<AppConfig> findById(long id) {
        List<AppConfig> rows = jdbcTemplate.query(
                "SELECT " + COLS + " FROM app_config WHERE id = ?", MAPPER, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** 某分组下的直接子项（parentId=null 表示顶层），按 sort、id 排序 */
    public List<AppConfig> findByParentId(Long parentId) {
        String sql = "SELECT " + COLS + " FROM app_config";
        sql += (parentId == null) ? " WHERE parent_id IS NULL" : " WHERE parent_id = ?";
        sql += " ORDER BY sort, id";
        return (parentId == null)
                ? jdbcTemplate.query(sql, MAPPER)
                : jdbcTemplate.query(sql, MAPPER, parentId);
    }

    /**
     * 交付读取：某 cfg_type 下启用的行，target 命中全部端兜底或指定端。
     * 注意：all 与具体端会同时返回，覆盖关系由 Service 层合并（all 先、具体端后）。
     */
    public List<AppConfig> findEnabledByTypeAndTarget(String cfgType, String target) {
        return jdbcTemplate.query("""
                SELECT %s FROM app_config
                WHERE enabled = TRUE AND cfg_type = ? AND (target = ? OR target = 'all')
                ORDER BY sort, id
                """.formatted(COLS), MAPPER, cfgType, target);
    }

    /** 同父级 + 同端下 cfg_key 是否已存在（excludeId &gt; 0 时排除自身，用于更新校验） */
    public boolean keyExistsInScope(String cfgKey, Long parentId, String target, long excludeId) {
        StringBuilder sql = new StringBuilder(
                "SELECT COUNT(*) FROM app_config WHERE cfg_key = ? AND target = ?");
        List<Object> args = new ArrayList<>();
        args.add(cfgKey);
        args.add(target);
        if (parentId == null) {
            sql.append(" AND parent_id IS NULL");
        } else {
            sql.append(" AND parent_id = ?");
            args.add(parentId);
        }
        if (excludeId > 0) {
            sql.append(" AND id <> ?");
            args.add(excludeId);
        }
        Long n = jdbcTemplate.queryForObject(sql.toString(), Long.class, args.toArray());
        return n != null && n > 0;
    }

    /** 是否还有子项（删除分组前校验，防止误删子树） */
    public boolean hasChildren(long parentId) {
        Long n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM app_config WHERE parent_id = ?", Long.class, parentId);
        return n != null && n > 0;
    }

    /** 新增，返回自增主键 id */
    public long insert(Long parentId, String nodeType, String cfgType, String cfgKey,
                       String cfgValue, String remark, String target, int sort, boolean enabled) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO app_config (parent_id, node_type, cfg_type, cfg_key, cfg_value, remark, target, sort, enabled) "
                            + "VALUES (?,?,?,?,?,?,?,?,?)",
                    new String[] { "id" });
            ps.setObject(1, parentId);
            ps.setString(2, nodeType);
            ps.setString(3, cfgType);
            ps.setString(4, cfgKey);
            ps.setString(5, cfgValue);
            ps.setString(6, remark);
            ps.setString(7, target);
            ps.setInt(8, sort);
            ps.setBoolean(9, enabled);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        return key == null ? 0 : key.longValue();
    }

    /**
     * 动态更新：只更新传入的非 null 字段；返回受影响行数（0 表示 id 不存在）。
     * parentId 特殊约定：0 表示“移动到顶层”（parent_id 置 NULL），>0 表示挂到该分组下；
     * 不传（null）表示不修改父子关系。
     */
    public int update(long id, Long parentId, String nodeType, String cfgType, String cfgKey,
                      String cfgValue, String remark, String target, Integer sort, Boolean enabled) {
        StringBuilder sql = new StringBuilder("UPDATE app_config SET ");
        List<Object> args = new ArrayList<>();
        if (parentId != null) {
            if (parentId == 0) {
                sql.append("parent_id = NULL, ");
            } else {
                sql.append("parent_id = ?, ");
                args.add(parentId);
            }
        }
        if (nodeType != null) { sql.append("node_type = ?, "); args.add(nodeType); }
        if (cfgType != null) { sql.append("cfg_type = ?, "); args.add(cfgType); }
        if (cfgKey != null) { sql.append("cfg_key = ?, "); args.add(cfgKey); }
        if (cfgValue != null) { sql.append("cfg_value = ?, "); args.add(cfgValue); }
        if (remark != null) { sql.append("remark = ?, "); args.add(remark); }
        if (target != null) { sql.append("target = ?, "); args.add(target); }
        if (sort != null) { sql.append("sort = ?, "); args.add(sort); }
        if (enabled != null) { sql.append("enabled = ?, "); args.add(enabled); }
        sql.append("updated_at = now(), ");
        if (args.isEmpty()) return 0;
        sql.setLength(sql.length() - 2);
        sql.append(" WHERE id = ?");
        args.add(id);
        return jdbcTemplate.update(sql.toString(), args.toArray());
    }

    public int delete(long id) {
        return jdbcTemplate.update("DELETE FROM app_config WHERE id = ?", id);
    }
}
