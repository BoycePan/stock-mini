package com.guyu.stock.model;

import java.sql.Date;
import java.sql.Timestamp;

/**
 * 微信小程序访问趋势日统计行（wx_daily_visit_stat 表）。
 *
 * <p>一行 = target(端) × stat_date(统计日)，来源为微信
 * 「获取用户访问小程序数据日趋势」接口（datacube/getweanalysisappiddailyvisittrend）。</p>
 *
 * <p>{@code visitUv} 即日活（访问人数），{@code visitUvNew} 即日新增（新用户数）；
 * 停留时长/访问深度为浮点，可空（部分日期微信未返回）。</p>
 */
public record WxDailyVisitStat(
        long id,
        String target,
        Date statDate,
        long sessionCnt,
        long visitPv,
        long visitUv,
        long visitUvNew,
        Double stayTimeUv,
        Double stayTimeSession,
        Double visitDepth,
        Timestamp pulledAt,
        Timestamp createdAt) {}
