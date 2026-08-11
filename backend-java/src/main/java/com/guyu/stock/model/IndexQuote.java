package com.guyu.stock.model;

import java.time.LocalDateTime;

/** 指数列表项：元数据(market) + 实时快照点位（stock_info LEFT JOIN quote_snapshot） */
public record IndexQuote(
        String code,
        String name,
        String market,
        Double price,
        Double pctChange,
        LocalDateTime updatedAt
) {}
