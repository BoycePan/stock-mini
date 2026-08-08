package com.guyu.stock.external.sina;

import com.fasterxml.jackson.annotation.JsonProperty;

public record Quote(
        String code,
        String name,
        double open,
        @JsonProperty("prev_close") double prevClose,
        double price,
        double high,
        double low,
        long volume,
        double amount,
        String date,
        String time,
        double turnover,
        @JsonProperty("pct_change") double pctChange
) {}
