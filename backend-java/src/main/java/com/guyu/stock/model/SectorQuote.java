package com.guyu.stock.model;

import java.time.LocalDateTime;

/** 板块列表项：元数据(market + board=industry/theme) + 实时快照点位（stock_info LEFT JOIN quote_snapshot） */
public record SectorQuote(
        String code,
        String name,
        String market,
        String board,
        Double price,
        Double pctChange,
        LocalDateTime updatedAt
) {}
