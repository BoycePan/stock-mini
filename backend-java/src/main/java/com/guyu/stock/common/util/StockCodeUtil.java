package com.guyu.stock.common.util;

/**
 * 股票代码工具：统一「6/9 开头 → sh、其他 → sz」的前缀映射（对齐 Go toSymbol），
 * 消除 SinaClient/SinaKlineClient/SinaNewsClient 三处重复实现。
 */
public final class StockCodeUtil {

    private StockCodeUtil() {}

    /** 6/9 开头 → sh，其他 → sz（对齐 Go toSymbol） */
    public static String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }
}
