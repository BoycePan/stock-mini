package com.guyu.stock.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.dao.NoticeRepository;
import com.guyu.stock.model.Notice;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 前端公告内容（notice 表）：
 * <ul>
 *   <li>管理端：{@link #list()} / {@link #create} / {@link #update} / {@link #delete}</li>
 *   <li>公开端：{@link #listPublic(String, String)} 按分端 + 位置 + 有效期返回当前有效公告</li>
 * </ul>
 * 排序规则：pinned DESC, sort ASC（同权重 created_at DESC 兜底）。
 */
@Service
public class NoticeService {

    private static final Logger log = LoggerFactory.getLogger(NoticeService.class);

    /** type 可扩展：新增类型只在此加值即可，无需改表 */
    private static final Set<String> TYPES = Set.of("notice", "banner", "marquee");

    private final NoticeRepository repository;
    private final ObjectMapper objectMapper;

    public NoticeService(NoticeRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    // ---------------- 管理端 ----------------

    /** 全量列表（config 返回原文，管理后台编辑 JSON 用） */
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Notice n : repository.findAll()) {
            result.add(toMap(n, true));
        }
        return result;
    }

    public Map<String, Object> create(String type, String title, String target, String position,
                                      Integer sort, Boolean pinned, Boolean enabled,
                                      String validFrom, String validTo, String config) {
        String t = normalizeType(type);
        String tgt = (target == null || target.isBlank()) ? "all" : target.trim();
        String pos = (position == null || position.isBlank()) ? "settings" : position.trim();
        int s = sort == null ? 0 : sort;
        boolean pin = Boolean.TRUE.equals(pinned);
        boolean en = enabled == null || enabled;
        String cfg = validateConfig(config);
        Timestamp from = parseTimestamp(validFrom, "validFrom");
        Timestamp to = parseTimestamp(validTo, "validTo");
        validatePeriod(from, to);

        long id = repository.insert(t, trimToNull(title), tgt, pos, s, pin, en, from, to, cfg);
        return findOrThrow(id);
    }

    public Map<String, Object> update(long id, String type, String title, String target, String position,
                                      Integer sort, Boolean pinned, Boolean enabled,
                                      String validFrom, String validTo, String config) {
        Notice cur = repository.findById(id)
                .orElseThrow(() -> new BizException(ErrCode.NOT_FOUND, "公告不存在: id=" + id));

        String effType = type != null ? normalizeType(type) : cur.type();
        String effConfig = config != null ? validateConfig(config) : cur.config();
        // validFrom/validTo：null=不修改；""=清除（置 NULL）；ISO=覆盖
        boolean fromChanged = validFrom != null;
        boolean toChanged = validTo != null;
        Timestamp effFrom = fromChanged ? parseTimestamp(validFrom, "validFrom") : cur.validFrom();
        Timestamp effTo = toChanged ? parseTimestamp(validTo, "validTo") : cur.validTo();
        validatePeriod(effFrom, effTo);

        int rows = repository.update(id, type, title, target, position, sort, pinned, enabled,
                effFrom, fromChanged, effTo, toChanged,
                config != null ? effConfig : null);
        if (rows == 0) throw new BizException(ErrCode.NOT_FOUND, "公告不存在: id=" + id);
        return findOrThrow(id);
    }

    public void delete(long id) {
        if (repository.findById(id).isEmpty()) {
            throw new BizException(ErrCode.NOT_FOUND, "公告不存在: id=" + id);
        }
        repository.delete(id);
    }

    // ---------------- 公开端 ----------------

    /**
     * 公开列表：启用的、命中分端、当前时间在有效期内的公告；config 解析为对象。
     * position 为空时返回该端全部位置的公告。
     */
    public List<Map<String, Object>> listPublic(String target, String position) {
        String tgt = (target == null || target.isBlank()) ? "all" : target.trim();
        String pos = trimToNull(position);
        List<Notice> rows = (pos == null)
                ? repository.findEnabledForTarget(tgt)
                : repository.findEnabledForDisplay(tgt, pos);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Notice n : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", n.id());
            m.put("type", n.type());
            m.put("title", n.title());
            m.put("position", n.position());
            m.put("sort", n.sort());
            m.put("pinned", n.pinned());
            m.put("config", parseConfig(n.config()));
            result.add(m);
        }
        return result;
    }

    // ---------------- 校验/转换 ----------------

    private String normalizeType(String type) {
        String t = trimToNull(type);
        if (t == null || !TYPES.contains(t)) {
            throw new BizException(ErrCode.INVALID_PARAM, "type 必须是 notice / banner / marquee 之一");
        }
        return t;
    }

    /** config 必须为空或合法 JSON 对象；返回压缩后的 JSON 文本 */
    private String validateConfig(String config) {
        String c = trimToNull(config);
        if (c == null) return null;
        try {
            if (!objectMapper.readTree(c).isObject()) {
                throw new BizException(ErrCode.INVALID_PARAM, "config 必须是 JSON 对象，如 {\"content\":\"...\"}");
            }
            return objectMapper.writeValueAsString(objectMapper.readTree(c));
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException(ErrCode.INVALID_PARAM, "config 不是合法 JSON");
        }
    }

    /** ISO 时间字符串（如 2026-01-01T00:00:00 或 2026-01-01T00:00:00+08:00）→ 东8区 TIMESTAMP */
    private Timestamp parseTimestamp(String value, String fieldName) {
        String v = trimToNull(value);
        if (v == null) return null;
        try {
            Instant instant = Instant.parse(v);
            LocalDateTime ldt = LocalDateTime.ofInstant(instant, ZoneId.of("Asia/Shanghai"));
            return Timestamp.valueOf(ldt);
        } catch (Exception e) {
            throw new BizException(ErrCode.INVALID_PARAM, fieldName + " 不是合法 ISO 时间: " + v);
        }
    }

    private void validatePeriod(Timestamp from, Timestamp to) {
        if (from != null && to != null && from.after(to)) {
            throw new BizException(ErrCode.INVALID_PARAM, "validFrom 不能晚于 validTo");
        }
    }

    private Object parseConfig(String config) {
        if (config == null || config.isBlank()) return null;
        try {
            return objectMapper.readValue(config, Object.class);
        } catch (Exception e) {
            log.warn("notice config 解析失败，按 null 处理: {}", config, e);
            return null;
        }
    }

    private Map<String, Object> findOrThrow(long id) {
        return repository.findById(id)
                .map(n -> toMap(n, true))
                .orElseThrow(() -> new BizException(ErrCode.SERVER_ERROR, "公告读取失败: id=" + id));
    }

    /** adminMode=true 时 config 返回原文（管理端编辑用）；false 时返回解析后的对象 */
    private Map<String, Object> toMap(Notice n, boolean adminMode) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.id());
        m.put("type", n.type());
        m.put("title", n.title());
        m.put("target", n.target());
        m.put("position", n.position());
        m.put("sort", n.sort());
        m.put("pinned", n.pinned());
        m.put("enabled", n.enabled());
        m.put("validFrom", n.validFrom() == null ? null : n.validFrom().toInstant().toString());
        m.put("validTo", n.validTo() == null ? null : n.validTo().toInstant().toString());
        m.put("config", adminMode ? n.config() : parseConfig(n.config()));
        m.put("createdAt", n.createdAt() == null ? null : n.createdAt().toInstant().toString());
        m.put("updatedAt", n.updatedAt() == null ? null : n.updatedAt().toInstant().toString());
        return m;
    }

    private String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
