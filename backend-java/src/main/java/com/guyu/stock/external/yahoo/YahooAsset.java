package com.guyu.stock.external.yahoo;

import java.util.ArrayList;
import java.util.List;

/**
 * 雅虎全球资产清单（商品/外汇/加密/美债/美股个股/中概），Yahoo 符号实测可拉通。
 * 统一由 YahooAssetService 处理，type 由调用方指定（commodity/forex/crypto/bond/stock），market 为 global 或 us。
 * category 用于 stock_info.board 分组展示（如 贵金属/能源/农产品/龙头 等）。
 */
public final class YahooAsset {

    public record Symbol(String code, String name, String market, String category) {}

    /** 大宗商品/期货（17） */
    public static final List<Symbol> COMMODITIES = List.of(
            // 贵金属
            new Symbol("GC=F", "黄金", "global", "贵金属"),
            new Symbol("SI=F", "白银", "global", "贵金属"),
            new Symbol("PL=F", "铂金", "global", "贵金属"),
            new Symbol("PA=F", "钯金", "global", "贵金属"),
            // 工业/有色金属
            new Symbol("HG=F", "铜", "global", "有色金属"),
            new Symbol("ALI=F", "铝", "global", "有色金属"),
            new Symbol("ZNC=F", "锌", "global", "有色金属"),
            new Symbol("LIT", "锂", "global", "有色金属"),
            new Symbol("TIO=F", "铁矿石", "global", "黑色金属"),
            // 能源
            new Symbol("CL=F", "WTI原油", "global", "能源"),
            new Symbol("BZ=F", "布伦特原油", "global", "能源"),
            new Symbol("NG=F", "天然气", "global", "能源"),
            // 农产品
            new Symbol("ZC=F", "玉米", "global", "农产品"),
            new Symbol("ZS=F", "大豆", "global", "农产品"),
            new Symbol("ZW=F", "小麦", "global", "农产品"),
            // 股指期货
            new Symbol("ES=F", "标普500期货", "global", "股指期货"),
            new Symbol("NQ=F", "纳指期货", "global", "股指期货")
    );

    /** 外汇（5） */
    public static final List<Symbol> FOREX = List.of(
            new Symbol("DX-Y.NYB", "美元指数", "global", "美元指数"),
            new Symbol("EURUSD=X", "欧元/美元", "global", "主流货币"),
            new Symbol("JPY=X", "美元/日元", "global", "主流货币"),
            new Symbol("GBPUSD=X", "英镑/美元", "global", "主流货币"),
            new Symbol("CNY=X", "美元/人民币", "global", "人民币")
    );

    /** 加密货币（2） */
    public static final List<Symbol> CRYPTO = List.of(
            new Symbol("BTC-USD", "比特币", "global", "龙头"),
            new Symbol("ETH-USD", "以太坊", "global", "龙头")
    );

    /** 美债 ETF（3，美股交易时段） */
    public static final List<Symbol> BONDS = List.of(
            new Symbol("TLT", "美国20年期国债", "us", "美债"),
            new Symbol("IEF", "美国10年期国债", "us", "美债"),
            new Symbol("SHY", "美国短期国债", "us", "美债")
    );

    /** 美股科技七巨头 + 中概股（16，美股交易时段） */
    public static final List<Symbol> STOCKS = List.of(
            new Symbol("NVDA", "英伟达", "us", "美股科技"),
            new Symbol("AAPL", "苹果", "us", "美股科技"),
            new Symbol("MSFT", "微软", "us", "美股科技"),
            new Symbol("GOOGL", "谷歌", "us", "美股科技"),
            new Symbol("AMZN", "亚马逊", "us", "美股科技"),
            new Symbol("META", "Meta", "us", "美股科技"),
            new Symbol("TSLA", "特斯拉", "us", "美股科技"),
            new Symbol("BABA", "阿里巴巴", "us", "中概股"),
            new Symbol("PDD", "拼多多", "us", "中概股"),
            new Symbol("JD", "京东", "us", "中概股"),
            new Symbol("BIDU", "百度", "us", "中概股"),
            new Symbol("NIO", "蔚来", "us", "中概股"),
            new Symbol("LI", "理想汽车", "us", "中概股"),
            new Symbol("XPEV", "小鹏汽车", "us", "中概股"),
            new Symbol("NTES", "网易", "us", "中概股"),
            new Symbol("BILI", "哔哩哔哩", "us", "中概股")
    );

    /** 全部分类合并，供快照批量刷新用 */
    public static final List<Symbol> ALL = merge(COMMODITIES, FOREX, CRYPTO, BONDS, STOCKS);

    private static List<Symbol> merge(List<Symbol>... lists) {
        List<Symbol> all = new ArrayList<>();
        for (List<Symbol> l : lists) all.addAll(l);
        return List.copyOf(all);
    }

    private YahooAsset() {}
}
