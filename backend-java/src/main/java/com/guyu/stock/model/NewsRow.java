package com.guyu.stock.model;

/** 新闻/公告写库行（news_feed 表）。从 NewsRepository 抽出。 */
public record NewsRow(String stockCode, String title, String summary, String url, String source, String publishedAt) {}
