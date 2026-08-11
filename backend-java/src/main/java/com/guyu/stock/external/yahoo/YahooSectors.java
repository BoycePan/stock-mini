package com.guyu.stock.external.yahoo;

import java.util.List;

/**
 * 雅虎板块 ETF 清单（Yahoo 符号，实测可拉通，见 EXTERNAL_API_ANALYSIS.md 7.1.3）。
 * market 为交易市场：us=美股行业/主题，global=全球行业（iShares MSCI 全球行业系列，美股上市但覆盖全球）。
 * category 用于 stock_info.board 分组展示（industry=行业板块 / theme=热门主题）。
 */
public final class YahooSectors {

    public record Symbol(String code, String name, String market, String category) {}

    public static final List<Symbol> SECTORS = List.of(
            // 美股行业板块（SPDR Select Sector）
            new Symbol("XLK", "科技", "us", "industry"),
            new Symbol("XLF", "金融", "us", "industry"),
            new Symbol("XLE", "能源", "us", "industry"),
            new Symbol("XLP", "必需消费", "us", "industry"),
            new Symbol("XLV", "医疗", "us", "industry"),
            new Symbol("XLI", "工业", "us", "industry"),
            new Symbol("XLB", "材料", "us", "industry"),
            new Symbol("XLU", "公用事业", "us", "industry"),
            new Symbol("VNQ", "房地产", "us", "industry"),
            // 美股热门主题
            new Symbol("SMH", "半导体", "us", "theme"),
            new Symbol("GLD", "黄金", "us", "theme"),
            new Symbol("GDX", "金矿", "us", "theme"),
            new Symbol("SLV", "白银", "us", "theme"),
            new Symbol("REMX", "稀土", "us", "theme"),
            new Symbol("URA", "铀", "us", "theme"),
            new Symbol("ITA", "军工", "us", "theme"),
            // 热门科技/成长主题（实测可拉通）
            new Symbol("BOTZ", "机器人AI", "us", "theme"),
            new Symbol("AIQ", "全球AI", "us", "theme"),
            new Symbol("ARKQ", "自主科技", "us", "theme"),
            new Symbol("ROBO", "机器人", "us", "theme"),
            new Symbol("ARKX", "太空探索", "us", "theme"),
            new Symbol("UFO", "太空", "us", "theme"),
            new Symbol("XSD", "半导体", "us", "theme"),
            new Symbol("SOXX", "半导体", "us", "theme"),
            new Symbol("CLOU", "云计算", "us", "theme"),
            new Symbol("SKYY", "云计算", "us", "theme"),
            new Symbol("HACK", "网络安全", "us", "theme"),
            new Symbol("DRIV", "电动车", "us", "theme"),
            new Symbol("ICLN", "清洁能源", "us", "theme"),
            new Symbol("TAN", "太阳能", "us", "theme"),
            new Symbol("QCLN", "绿色能源", "us", "theme"),
            new Symbol("XBI", "生物科技", "us", "theme"),
            new Symbol("IBB", "生物科技", "us", "theme"),
            new Symbol("BLOK", "区块链", "us", "theme"),
            new Symbol("BKCH", "区块链", "us", "theme"),
            // 全球行业板块（iShares MSCI Global Sector，美股上市，覆盖全球市场）
            new Symbol("IXN", "全球科技", "global", "industry"),
            new Symbol("IXG", "全球金融", "global", "industry"),
            new Symbol("IXJ", "全球医疗", "global", "industry"),
            new Symbol("IXC", "全球能源", "global", "industry"),
            new Symbol("IXP", "全球通讯", "global", "industry"),
            new Symbol("KXI", "全球必需消费", "global", "industry"),
            new Symbol("RXI", "全球可选消费", "global", "industry"),
            new Symbol("EXI", "全球工业", "global", "industry"),
            new Symbol("JXI", "全球公用事业", "global", "industry"),
            new Symbol("MXI", "全球材料", "global", "industry")
    );

    private YahooSectors() {}
}
