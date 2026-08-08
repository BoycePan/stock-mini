package com.guyu.stock.external.ths;

public record BoardKLine(String date, double open, double high, double low, double close, long volume, double amount) {}
