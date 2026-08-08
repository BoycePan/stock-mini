package com.guyu.stock.stock;

import java.time.LocalDateTime;

public record StockInfo(
        String code,
        String name,
        String type,
        String market,
        String board,
        String industry,
        boolean isActive,
        LocalDateTime updatedAt
) {}
