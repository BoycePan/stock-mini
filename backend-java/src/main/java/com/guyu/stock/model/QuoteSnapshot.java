package com.guyu.stock.model;

import java.time.LocalDateTime;

/** 指数/行情实时快照（quote_snapshot，定时覆盖刷新，仅存最新值） */
public record QuoteSnapshot(
        String code,
        String name,
        double price,
        double pctChange,
        LocalDateTime updatedAt
) {}
