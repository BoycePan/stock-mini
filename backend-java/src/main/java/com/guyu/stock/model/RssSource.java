package com.guyu.stock.model;

/** RSS 新闻源（rss_source 表）。id 仅查询时填充；种子写入时忽略。 */
public record RssSource(long id, String name, String url, boolean viaWorker) {}
