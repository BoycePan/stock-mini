package com.guyu.stock.model;

import java.sql.Timestamp;

/**
 * 微信广告日统计行（wx_ad_daily_stat 表）。
 *
 * <p>一行 = target(端) × ad_slot(广告位类型) × stat_date(统计日)。
 * 金额单位：{@code incomeFen} 为"分"；{@code ecpmFen} 为"分/千次曝光"；
 * 率字段 {@code exposureRate}/{@code clickRate} 为 0~1 小数。</p>
 *
 * <p>{@code adSlotName} 是广告位类型中文名（封面广告 / 原生模板广告 / ...），
 * 微信接口不返回，由 Service 层按 {@code adSlot} 枚举映射填充。</p>
 */
public record WxAdDailyStat(
        long id,
        String target,
        java.sql.Date statDate,
        Long slotId,
        String adSlot,
        String adSlotName,
        long reqSuccCount,
        long exposureCount,
        java.math.BigDecimal exposureRate,
        long clickCount,
        java.math.BigDecimal clickRate,
        long incomeFen,
        java.math.BigDecimal ecpmFen,
        Timestamp pulledAt,
        Timestamp createdAt) {}
