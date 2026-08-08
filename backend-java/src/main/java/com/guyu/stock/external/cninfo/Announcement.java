package com.guyu.stock.external.cninfo;

public record Announcement(
        String id,
        String title,
        String time,
        String url,
        String pdf) {}
