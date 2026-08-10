package com.guyu.stock.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;

public record StockInfo(
        String code,
        String name,
        String type,
        String market,
        String board,
        String industry,
        @JsonProperty("is_active") boolean isActive,
        @JsonIgnore LocalDateTime updatedAt
) {}
