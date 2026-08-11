package com.guyu.stock.external.yahoo;

import java.util.ArrayList;
import java.util.List;

/**
 * 雅虎全球资产清单（商品/外汇/加密），Yahoo 符号实测可拉通，见 EXTERNAL_API_ANALYSIS.md 7.1.4 / 7.1.5。
 * 统一由 YahooAssetService 处理，type 由调用方指定（commodity/forex/crypto），market 为 global。
 * category 用于 stock_info.board 分组展示（如 贵金属/能源/主流/龙头）。
 */
public final class YahooAsset {

    public record Symbol(String code, String name, String market, String category) {}

    /** 大宗商品/期货（8） */
    public static final List<Symbol> COMMODITIES = List.of(
            new Symbol("GC=F", "黄金", "global", "贵金属"),
            new Symbol("SI=F", "白银", "global", "贵金属"),
            new Symbol("HG=F", "铜", "global", "金属"),
            new Symbol("CL=F", "WTI原油", "global", "能源"),
            new Symbol("BZ=F", "布伦特原油", "global", "能源"),
            new Symbol("NG=F", "天然气", "global", "能源"),
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

    /** 三类合并，供快照批量刷新用 */
    public static final List<Symbol> ALL = merge(COMMODITIES, FOREX, CRYPTO);

    private static List<Symbol> merge(List<Symbol>... lists) {
        List<Symbol> all = new ArrayList<>();
        for (List<Symbol> l : lists) all.addAll(l);
        return List.copyOf(all);
    }

    private YahooAsset() {}
}
