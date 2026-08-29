package com.guyu.stock.model;

import java.sql.Timestamp;

/**
 * 前端公告内容行（notice 表）。
 *
 * <p>分端（{@code target}） + 展示位置（{@code position}） + 有效期（{@code validFrom/validTo}） +
 * 置顶（{@code pinned}）/排序（{@code sort}）；排序规则 {@code pinned DESC, sort ASC}。
 *
 * <p>{@code config} 为 {@code type} 特有内容的 JSON 文本（TEXT 列，对齐 {@link ClickEvent#props()} 先例），
 * 如 {@code {"content":"...","icon":"🚀","link":"/page/x"}}，读取时由 Service 解析。
 */
public record Notice(
        long id,
        String type,
        String title,
        String target,
        String position,
        int sort,
        boolean pinned,
        boolean enabled,
        Timestamp validFrom,
        Timestamp validTo,
        String config,
        Timestamp createdAt,
        Timestamp updatedAt) {}
