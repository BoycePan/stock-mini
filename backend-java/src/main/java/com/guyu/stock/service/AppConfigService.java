package com.guyu.stock.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.dao.AppConfigRepository;
import com.guyu.stock.model.AppConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 前端展示配置（app_config 表）：
 * <ul>
 *   <li>管理端：{@link #list()} / {@link #create} / {@link #update} / {@link #delete}（树形 CRUD）</li>
 *   <li>交付端：{@link #deliveryMap(String, String)} 把树形配置摊平成 JSON 对象返回
 *       （分组→嵌套对象，单独项→顶层键；all 兜底、具体端覆盖）。</li>
 * </ul>
 */
@Service
public class AppConfigService {

    private static final Logger log = LoggerFactory.getLogger(AppConfigService.class);

    private static final Set<String> NODE_TYPES = Set.of("group", "item");
    private static final Set<String> CFG_TYPES = Set.of("login", "display", "other");

    private final AppConfigRepository repository;
    private final ObjectMapper objectMapper;

    public AppConfigService(AppConfigRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    // ---------------- 管理端 ----------------

    /** 全量平铺列表（含 id/parentId，管理后台自建树形结构） */
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (AppConfig c : repository.findAll()) {
            result.add(toMap(c));
        }
        return result;
    }

    /** 新增分组或配置项 */
    public Map<String, Object> create(Long parentId, String nodeType, String cfgType, String cfgKey,
                                      String cfgValue, String remark, String target, Integer sort, Boolean enabled) {
        String nt = normalizeNodeType(nodeType);
        String ct = normalizeCfgType(cfgType);
        String key = requireKey(cfgKey);
        String tgt = (target == null || target.isBlank()) ? "all" : target.trim();
        int s = sort == null ? 0 : sort;
        boolean en = enabled == null || enabled;
        Long pid = validateParent(parentId, ct);

        String value = validateValue(nt, cfgValue);
        validateKeyUnique(key, pid, tgt, 0);

        long id = repository.insert(pid, nt, ct, key, value, trimToNull(remark), tgt, s, en);
        return findOrThrow(id);
    }
    /** 更新（部分字段）：只校验/生效传入的字段，未传保持原值 */
    public Map<String, Object> update(long id, Long parentId, String nodeType, String cfgType, String cfgKey,
                                      String cfgValue, String remark, String target, Integer sort, Boolean enabled) {
        AppConfig cur = repository.findById(id)
                .orElseThrow(() -> new BizException(ErrCode.NOT_FOUND, "配置不存在: id=" + id));

        String effNodeType = nodeType != null ? normalizeNodeType(nodeType) : cur.nodeType();
        String effCfgType = cfgType != null ? normalizeCfgType(cfgType) : cur.cfgType();
        String effCfgKey = cfgKey != null ? requireKey(cfgKey) : cur.cfgKey();
        String effCfgValue = cfgValue != null ? validateValue(effNodeType, cfgValue) : cur.cfgValue();
        String effTarget = (target != null && !target.isBlank()) ? target.trim() : cur.target();

        // parentId 约定：0=移动到顶层，>0=挂到该分组下，null=不修改
        Long effParent = cur.parentId();
        if (parentId != null) {
            effParent = (parentId == 0) ? null : validateParent(parentId, effCfgType);
        } else if (cfgType != null && effParent != null) {
            // 只改 cfg_type：原父分组的 cfg_type 必须与新值一致
            validateParentType(effParent, effCfgType);
        }
        if (effParent != null && effParent == id) {
            throw new BizException(ErrCode.INVALID_PARAM, "不能把节点挂到自己下面");
        }
        // 校验新 cfg_key 在“同父级 + 同端”作用域内唯一
        validateKeyUnique(effCfgKey, effParent, effTarget, id);

        int rows = repository.update(id, parentId, nodeType, cfgType,
                cfgKey != null ? effCfgKey : null,
                cfgValue != null ? effCfgValue : null,
                remark, target, sort, enabled);
        if (rows == 0) throw new BizException(ErrCode.NOT_FOUND, "配置不存在: id=" + id);
        return findOrThrow(id);
    }

    /** 删除：分组下还有子项时拒绝（防止误删子树） */
    public void delete(long id) {
        AppConfig cur = repository.findById(id)
                .orElseThrow(() -> new BizException(ErrCode.NOT_FOUND, "配置不存在: id=" + id));
        if ("group".equals(cur.nodeType()) && repository.hasChildren(id)) {
            throw new BizException(ErrCode.INVALID_PARAM, "该分组下还有子项，请先删除或移走子项");
        }
        repository.delete(id);
    }

    // ---------------- 交付端 ----------------

    /**
     * 按交付类型组装 JSON 对象（登录下发 / /api/v1/configs 共用）：
     * <ul>
     *   <li>分组（group）→ 嵌套对象，容器键为分组 cfg_key，递归装子项</li>
     *   <li>单独项 / item → 顶层键 cfg_key，值为解析后的 cfg_value</li>
     *   <li>target='all' 的行先应用，指定 source 的行后应用并覆盖（深合并）</li>
     * </ul>
     */
    public Map<String, Object> deliveryMap(String target, String cfgType) {
        String tgt = (target == null || target.isBlank()) ? "all" : target.trim();
        String ct = normalizeCfgType(cfgType);
        List<AppConfig> rows = repository.findEnabledByTypeAndTarget(ct, tgt);

        // all 行在前、指定端行在后（稳定排序，同端内保持 sort/id 顺序）：
        // 建树时同名 cfgKey 后写覆盖先写，天然实现「all 兜底、具体端覆盖」；
        // 同时全量行共享 childrenByParent 索引，跨端父子边（父=all 子=target 等）不再断裂。
        List<AppConfig> ordered = new ArrayList<>(rows);
        ordered.sort(Comparator.comparingInt(r -> "all".equals(r.target()) ? 0 : 1));
        return buildTree(ordered);
    }

    /** 平铺行 → 树形 Map：分组为嵌套对象（同名分组深合并），item 为解析后的值 */
    private Map<String, Object> buildTree(List<AppConfig> rows) {
        Map<Long, List<AppConfig>> childrenByParent = new HashMap<>();
        for (AppConfig r : rows) {
            Long p = r.parentId();
            childrenByParent.computeIfAbsent(p == null ? -1L : p, k -> new ArrayList<>()).add(r);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (AppConfig r : childrenByParent.getOrDefault(-1L, List.of())) {
            mergeNode(result, r, childrenByParent);
        }
        return result;
    }

    private void mergeNode(Map<String, Object> map, AppConfig node, Map<Long, List<AppConfig>> childrenByParent) {
        if ("group".equals(node.nodeType())) {
            Map<String, Object> sub = new LinkedHashMap<>();
            for (AppConfig child : childrenByParent.getOrDefault(node.id(), List.of())) {
                mergeNode(sub, child, childrenByParent);
            }
            Object prev = map.get(node.cfgKey());
            if (prev instanceof Map<?, ?> prevMap) {
                // 同名分组（all 与具体端各一份，或跨端复用的分组）：深合并，target 子项覆盖/追加
                @SuppressWarnings("unchecked")
                Map<String, Object> t = (Map<String, Object>) prevMap;
                deepMerge(t, sub);
            } else {
                map.put(node.cfgKey(), sub);
            }
        } else {
            map.put(node.cfgKey(), parseValue(node.cfgValue()));
        }
    }

    /** 深合并：source 的键覆盖 target；两侧都是 Map 时递归合并 */
    private void deepMerge(Map<String, Object> target, Map<String, Object> source) {
        for (Map.Entry<String, Object> e : source.entrySet()) {
            Object tv = target.get(e.getKey());
            if (tv instanceof Map<?, ?> tm && e.getValue() instanceof Map<?, ?> sm) {
                @SuppressWarnings("unchecked")
                Map<String, Object> t = (Map<String, Object>) tm;
                @SuppressWarnings("unchecked")
                Map<String, Object> s = (Map<String, Object>) sm;
                deepMerge(t, s);
            } else {
                target.put(e.getKey(), e.getValue());
            }
        }
    }

    // ---------------- 校验/转换 ----------------

    private String normalizeNodeType(String nodeType) {
        String nt = trimToNull(nodeType);
        if (nt == null || !NODE_TYPES.contains(nt)) {
            throw new BizException(ErrCode.INVALID_PARAM, "nodeType 必须是 group 或 item");
        }
        return nt;
    }

    private String normalizeCfgType(String cfgType) {
        String ct = trimToNull(cfgType);
        if (ct == null || !CFG_TYPES.contains(ct)) {
            throw new BizException(ErrCode.INVALID_PARAM, "cfgType 必须是 login / display / other 之一");
        }
        return ct;
    }

    private String requireKey(String cfgKey) {
        String key = trimToNull(cfgKey);
        if (key == null) {
            throw new BizException(ErrCode.INVALID_PARAM, "cfgKey 不能为空");
        }
        return key;
    }

    /** 父节点校验：存在、必须是分组、且 cfgType 与子项一致；返回 null（顶层）或父 id */
    private Long validateParent(Long parentId, String cfgType) {
        if (parentId == null || parentId <= 0) return null;
        AppConfig parent = repository.findById(parentId)
                .orElseThrow(() -> new BizException(ErrCode.INVALID_PARAM, "父节点不存在: id=" + parentId));
        if (!"group".equals(parent.nodeType())) {
            throw new BizException(ErrCode.INVALID_PARAM, "父节点必须是分组(group)");
        }
        if (!parent.cfgType().equals(cfgType)) {
            throw new BizException(ErrCode.INVALID_PARAM,
                    "子项 cfgType 必须与父分组一致（父分组为 " + parent.cfgType() + "）");
        }
        return parentId;
    }

    /** 仅校验父分组的 cfgType（用于只改 cfg_type 时） */
    private void validateParentType(Long parentId, String cfgType) {
        if (parentId == null) return;
        AppConfig parent = repository.findById(parentId)
                .orElseThrow(() -> new BizException(ErrCode.INVALID_PARAM, "父节点不存在: id=" + parentId));
        if (!parent.cfgType().equals(cfgType)) {
            throw new BizException(ErrCode.INVALID_PARAM,
                    "子项 cfgType 必须与父分组一致（父分组为 " + parent.cfgType() + "）");
        }
    }

    /**
     * 值校验：item 必须是非空合法 JSON；group 必须为空。
     * 返回压缩后的 JSON 文本（null 表示空）。
     */
    private String validateValue(String nodeType, String cfgValue) {
        if ("group".equals(nodeType)) {
            if (cfgValue != null && !cfgValue.isBlank()) {
                throw new BizException(ErrCode.INVALID_PARAM, "分组(group)不需要 cfg_value");
            }
            return null;
        }
        String v = trimToNull(cfgValue);
        if (v == null) {
            throw new BizException(ErrCode.INVALID_PARAM, "配置项(item)的 cfg_value 不能为空");
        }
        try {
            return objectMapper.writeValueAsString(objectMapper.readTree(v));
        } catch (Exception e) {
            throw new BizException(ErrCode.INVALID_PARAM, "cfg_value 不是合法 JSON");
        }
    }

    /** 同父级 + 同端作用域内 cfg_key 唯一 */
    private void validateKeyUnique(String cfgKey, Long parentId, String target, long excludeId) {
        if (repository.keyExistsInScope(cfgKey, parentId, target, excludeId)) {
            throw new BizException(ErrCode.INVALID_PARAM,
                    "cfg_key 已存在（同父级 + 同端下唯一）: " + cfgKey);
        }
    }

    /** 解析存储的 JSON 文本；异常时记日志返回 null（写入已校验，理论不会发生） */
    private Object parseValue(String cfgValue) {
        if (cfgValue == null || cfgValue.isBlank()) return null;
        try {
            return objectMapper.readValue(cfgValue, Object.class);
        } catch (Exception e) {
            log.warn("app_config cfg_value 解析失败，按 null 处理: {}", cfgValue, e);
            return null;
        }
    }

    private Map<String, Object> findOrThrow(long id) {
        return repository.findById(id)
                .map(this::toMap)
                .orElseThrow(() -> new BizException(ErrCode.SERVER_ERROR, "配置读取失败: id=" + id));
    }

    private Map<String, Object> toMap(AppConfig c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.id());
        m.put("parentId", c.parentId());
        m.put("nodeType", c.nodeType());
        m.put("cfgType", c.cfgType());
        m.put("cfgKey", c.cfgKey());
        m.put("cfgValue", c.cfgValue());
        m.put("remark", c.remark());
        m.put("target", c.target());
        m.put("sort", c.sort());
        m.put("enabled", c.enabled());
        m.put("updatedAt", c.updatedAt() == null ? null : c.updatedAt().toInstant().toString());
        return m;
    }

    private String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
