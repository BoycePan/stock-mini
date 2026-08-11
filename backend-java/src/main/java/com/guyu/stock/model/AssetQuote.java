package com.guyu.stock.model;

import java.time.LocalDateTime;

/** 全球资产列表项（商品/外汇/加密）：元数据(type + market + board + 交易时段) + 实时快照点位（stock_info LEFT JOIN quote_snapshot） */
public record AssetQuote(
        String code,
        String name,
        String type,
        String market,
        String board,
        Double price,
        Double pctChange,
        LocalDateTime updatedAt,
        String tradingHours,
        boolean isTrading
) {}
