package com.guyu.stock.common.util;

import cn.hutool.core.util.NumberUtil;
import cn.hutool.core.util.StrUtil;

/**
 * 数值解析工具（对齐 Go 侧语义）：解析失败一律返回默认值 0，而非抛异常。
 * 统一散落在 SinaClient/ThsParser/EastmoneyKlineClient/SinaInfoClient 的 try/catch 拷贝。
 * 底层使用 Hutool NumberUtil（hutool-core）。
 */
public final class NumUtil {

    private NumUtil() {}

    /** 解析 double，失败/空/非法返回 0（对齐 Go parseFloat 语义） */
    public static double parseDouble(String s) {
        return NumberUtil.parseDouble(StrUtil.trim(s), 0.0);
    }

    /** 解析 long，失败/空/非法返回 0（对齐 Go parseInt64 语义） */
    public static long parseLong(String s) {
        return NumberUtil.parseLong(StrUtil.trim(s), 0L);
    }

    /** 解析 int，失败/空/非法返回 0（对齐 Go parseInt 语义） */
    public static int parseInt(String s) {
        return NumberUtil.parseInt(StrUtil.trim(s), 0);
    }

    /** 对齐 Go round2：float64(int(v*100+0.5))/100，向零截断（负值 -1.235 → -1.23，与 Java Math.round 的 half-up 不同） */
    public static double round2(double v) {
        return (long) (v * 100 + 0.5) / 100.0;
    }
}
