package com.guyu.stock.external.yahoo;

import java.util.List;

/**
 * 全球主要指数清单（Yahoo 符号，实测可拉通）。
 * 覆盖美国/中国/亚太/欧洲/美洲主流市场指数。market 为国家/地区市场代码（用于 stock_info 分组展示）。
 */
public final class YahooIndices {

    public record Symbol(String code, String name, String market) {}

    public static final List<Symbol> INDICES = List.of(
            // 美国
            new Symbol("^GSPC", "标普500", "us"),
            new Symbol("^DJI", "道琼斯", "us"),
            new Symbol("^IXIC", "纳斯达克综合", "us"),
            new Symbol("^NDX", "纳斯达克100", "us"),
            new Symbol("^RUT", "罗素2000", "us"),
            new Symbol("^VIX", "VIX波动率", "us"),
            // 中国
            new Symbol("000001.SS", "上证综指", "cn"),
            new Symbol("399001.SZ", "深证成指", "cn"),
            new Symbol("000300.SS", "沪深300", "cn"),
            new Symbol("^HSI", "恒生指数", "hk"),
            // 亚太
            new Symbol("^TWII", "台湾加权", "tw"),
            new Symbol("^N225", "日经225", "jp"),
            new Symbol("^KS11", "韩国KOSPI", "kr"),
            new Symbol("^BSESN", "印度SENSEX", "in"),
            new Symbol("^AXJO", "澳洲ASX200", "au"),
            new Symbol("^STI", "新加坡海峡", "sg"),
            // 欧洲
            new Symbol("^FTSE", "英国富时100", "gb"),
            new Symbol("^GDAXI", "德国DAX", "de"),
            new Symbol("^FCHI", "法国CAC40", "fr"),
            new Symbol("^STOXX50E", "欧元区50", "eu"),
            new Symbol("^IBEX", "西班牙IBEX35", "es"),
            new Symbol("^AEX", "荷兰AEX", "nl"),
            // 美洲
            new Symbol("^GSPTSE", "加拿大TSX", "ca"),
            new Symbol("^BVSP", "巴西Bovespa", "br"),
            new Symbol("^MXX", "墨西哥IPC", "mx")
    );

    private YahooIndices() {}
}
