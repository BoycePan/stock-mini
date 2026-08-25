package com.guyu.stock.model;

/**
 * 用户点击/行为事件入库行（click_event 表）。
 *
 * <p>由 {@code TrackService} 从 {@link TrackEvent}（客户端上报）+ 后端补充字段
 * （{@code userId} / {@code ip}）组装而成；{@code props} 已序列化为 JSON 字符串
 * （TEXT 列，生产库可用 {@code props::jsonb} 做 JSON 查询），{@code serverTs}
 * 由数据库 {@code DEFAULT now()} 生成，不入参。
 */
public record ClickEvent(
        String eventId,
        Long userId,
        String sessionId,
        String eventType,
        String eventName,
        String page,
        String target,
        String props,
        Integer durationMs,
        Long clientTs,
        String ip,
        String platform,
        String appVersion) {}
