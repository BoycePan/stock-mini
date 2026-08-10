package com.guyu.stock.model;

import java.time.LocalDate;

public record StockKline(
        String code,
        String scale,
        LocalDate tradeDate,
        double open,
        double high,
        double low,
        double close,
        long volume,
        double amount,
        double turnover,
        double pctChange,
        double changeAmt,
        double amplitude
) {}
