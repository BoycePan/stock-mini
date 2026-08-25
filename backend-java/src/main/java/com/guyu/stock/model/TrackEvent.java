package com.guyu.stock.model;

/**
 * 客户端埋点上报事件（POST /api/v1/track/events 批量体里的单条）。
 *
 * <p>字段与前端埋点 SDK 契约一一对应（camelCase）：
 * <ul>
 *   <li>{@code eventId}：客户端生成的幂等键（sessionId + 自增序号），服务端据此去重；</li>
 *   <li>{@code eventName}：点分事件名，如 {@code search.submit}；</li>
 *   <li>{@code eventType}：事件大类，如 {@code page_view} / {@code tap} / {@code action}；</li>
 *   <li>{@code page} / {@code target}：触发页路由与目标（跳转页、标的 code 等）；</li>
 *   <li>{@code props}：扩展属性（JSON 对象，任意结构）；</li>
 *   <li>{@code durationMs}：页面停留时长（page_hide 类事件）；</li>
 *   <li>{@code clientTs}：客户端事件时间戳（毫秒），用于还原真实行为时间。</li>
 * </ul>
 *
 * <p>{@code user_id}、来源 {@code ip}、服务端接收时间由后端补充，不在客户端字段内。
 */
public record TrackEvent(
        String eventId,
        String eventName,
        String eventType,
        String page,
        String target,
        Object props,
        Integer durationMs,
        String sessionId,
        Long clientTs,
        String platform,
        String appVersion) {}
