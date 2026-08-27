package com.guyu.stock.model;

import java.sql.Timestamp;

/**
 * 前端展示配置行（app_config 表）。
 *
 * <p>两个正交维度：
 * <ul>
 *   <li>结构轴：{@code nodeType} = {@code group}（分组，可挂子项）/ {@code item}（配置项，有值），
 *       父子关系由 {@code parentId} 表达；{@code parentId == null} 且 {@code nodeType=item} 为“单独项”。</li>
 *   <li>交付轴：{@code cfgType} = {@code login}（跟随登录接口下发）/ {@code display}（前端渲染读取）/
 *       {@code other}（其他，可扩展枚举）。</li>
 * </ul>
 *
 * <p>{@code cfgValue} 为 JSON 文本（TEXT 列，对齐 {@link ClickEvent#props()} 先例）；
 * 读取/下发时由 Service 用 ObjectMapper 解析为对象。
 */
public record AppConfig(
        long id,
        Long parentId,
        String nodeType,
        String cfgType,
        String cfgKey,
        String cfgValue,
        String remark,
        String target,
        int sort,
        boolean enabled,
        Timestamp updatedAt) {}
