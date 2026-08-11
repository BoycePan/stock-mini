package com.guyu.stock.common.util;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Map;

/**
 * 交易时段工具：按 type+market 返回各资产所在市场的开市时段（统一北京时间），并判断当前是否开市。
 *
 * <p>跨天时段（如美股 21:30-04:00）的「开盘日」归属很关键：北京时间周六凌晨 02:00 对应美国周五下午
 * （还在开市），北京时间周一凌晨 02:00 对应美国周日下午（不开市）。因此周末判断用「开盘日的星期」，
 * 而不是当前日期的星期，避免北京时差导致的漏刷/误刷。
 *
 * <p>简化约定（可接受的近似，只影响 isTrading 边缘判断，不影响数据正确性）：
 * <ul>
 *   <li>忽略午休（A股/港股/日股实际有午休，忽略）；</li>
 *   <li>按夏令时基准（冬令时各市场整体 +1 小时）；</li>
 *   <li>外汇简化为 05:00-次日05:00（实际周初/周末边缘略有出入）；</li>
 *   <li>加密 7×24 恒开。</li>
 * </ul>
 */
public final class TradingHours {

    /** 一个交易时段：open/close 为北京时间；crossesMidnight=true 表示跨天（如 21:30-04:00）。 */
    public record Window(LocalTime open, LocalTime close, boolean crossesMidnight) {}

    private static final Window COMMODITY = new Window(LocalTime.of(6, 0), LocalTime.of(5, 0), true);
    private static final Window FOREX = new Window(LocalTime.of(5, 0), LocalTime.of(5, 0), true);
    private static final String CRYPTO_HOURS = "24H";

    private static final Map<String, Window> BY_MARKET = Map.ofEntries(
            Map.entry("us", window("21:30", "04:00")),
            Map.entry("global", window("21:30", "04:00")), // iShares 全球行业，美股交易
            Map.entry("cn", window("09:30", "15:00")),
            Map.entry("hk", window("09:30", "16:00")),
            Map.entry("tw", window("09:00", "13:30")),
            Map.entry("jp", window("08:00", "14:30")),
            Map.entry("kr", window("08:00", "14:30")),
            Map.entry("in", window("11:15", "17:30")),
            Map.entry("au", window("08:00", "14:00")),
            Map.entry("sg", window("09:00", "17:00")),
            Map.entry("gb", window("15:00", "23:30")),
            Map.entry("de", window("15:00", "23:30")),
            Map.entry("fr", window("15:00", "23:30")),
            Map.entry("eu", window("15:00", "23:30")),
            Map.entry("es", window("15:00", "23:30")),
            Map.entry("nl", window("15:00", "23:30")),
            Map.entry("ca", window("21:30", "04:00")),
            Map.entry("br", window("21:00", "04:00")),
            Map.entry("mx", window("22:30", "05:00")),
            Map.entry("vn", window("10:00", "15:30")),
            Map.entry("id", window("10:00", "16:30")),
            Map.entry("th", window("11:00", "17:30"))
    );

    private TradingHours() {}

    private static Window window(String open, String close) {
        LocalTime o = LocalTime.parse(open);
        LocalTime c = LocalTime.parse(close);
        return new Window(o, c, !o.isBefore(c));
    }

    /** 当前（北京时间）是否处于该 type+market 资产的交易时段。 */
    public static boolean isTrading(String type, String market) {
        return isTrading(type, market, LocalDateTime.now());
    }

    /** 指定时刻是否处于交易时段（测试与内部复用；now 为北京时间）。 */
    public static boolean isTrading(String type, String market, LocalDateTime now) {
        LocalDate date = now.toLocalDate();
        LocalTime time = now.toLocalTime();
        if ("crypto".equals(type)) return true; // 7×24
        if ("commodity".equals(type)) return inWindow(time, date, COMMODITY);
        if ("forex".equals(type)) return inWindow(time, date, FOREX);
        // 股票/板块
        Window w = BY_MARKET.get(market);
        return w == null || inWindow(time, date, w); // 未知市场默认开市，避免漏刷
    }

    /** 返回该 type+market 的交易时段字符串（北京时间），如 "21:30-04:00" / "24H"；未知返回 null。 */
    public static String tradingHours(String type, String market) {
        if ("crypto".equals(type)) return CRYPTO_HOURS;
        if ("commodity".equals(type)) return "06:00-05:00";
        if ("forex".equals(type)) return "05:00-05:00";
        Window w = BY_MARKET.get(market);
        if (w == null) return null;
        return w.open().toString().substring(0, 5) + "-" + w.close().toString().substring(0, 5);
    }

    /** 跨天时段按开盘日星期判断；非跨天按当天星期判断（北京时间周末=本地市场周末，如 A股/欧洲白天时段）。 */
    private static boolean inWindow(LocalTime time, LocalDate date, Window w) {
        if (w.crossesMidnight()) {
            // 开盘日：now>=open → 今天；now<open（凌晨，close 前）→ 昨天
            LocalDate openDay = time.isBefore(w.open()) ? date.minusDays(1) : date;
            if (isWeekend(openDay)) return false;
            return !time.isBefore(w.open()) || time.isBefore(w.close());
        }
        if (isWeekend(date)) return false;
        return !time.isBefore(w.open()) && time.isBefore(w.close());
    }

    private static boolean isWeekend(LocalDate d) {
        DayOfWeek dow = d.getDayOfWeek();
        return dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY;
    }
}
