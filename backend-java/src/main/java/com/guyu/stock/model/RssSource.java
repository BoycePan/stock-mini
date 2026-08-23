package com.guyu.stock.model;

import java.sql.Timestamp;

/**
 * RSS 新闻源（rss_source 表）。id 仅查询时填充；种子写入时忽略。
 * 新增字段：enabled（启用开关）、deleted（软删除）、last_*（最近一次拉取状态，管理后台展示用）。
 */
public record RssSource(
        long id,
        String name,
        String url,
        boolean viaWorker,
        boolean enabled,
        boolean deleted,
        String lastStatus,
        String lastError,
        Timestamp lastFetchAt,
        Integer lastItemCount) {}
