package com.guyu.stock.service;

import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.common.util.TradingHours;
import com.guyu.stock.external.yahoo.YahooAsset;
import com.guyu.stock.external.yahoo.YahooIndices;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.external.yahoo.YahooSectors;
import com.guyu.stock.model.AssetQuote;
import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.SectorQuote;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 全局实时快照（指数 + 板块 ETF）：定时任务批量拉最新点位覆盖落库 quote_snapshot；查询只读库。
 */
@Service
public class YahooQuoteService {

    private static final Logger log = LoggerFactory.getLogger(YahooQuoteService.class);

    private final YahooKlineClient yahooKlineClient;
    private final YahooQuoteRepository quoteRepository;

    public YahooQuoteService(YahooKlineClient yahooKlineClient, YahooQuoteRepository quoteRepository) {
        this.yahooKlineClient = yahooKlineClient;
        this.quoteRepository = quoteRepository;
    }

    /** 批量拉指数+板块+全球资产最新点位并覆盖落库；只刷当前开市的 symbol（闭市保留旧快照），返回更新条数 */
    public int refreshSnapshot() {
        List<String> codes = new ArrayList<>();
        Map<String, String> names = new HashMap<>();
        for (YahooIndices.Symbol s : YahooIndices.INDICES) {
            if (TradingHours.isTrading("index", s.market())) {
                codes.add(s.code());
                names.put(s.code(), s.name());
            }
        }
        for (YahooSectors.Symbol s : YahooSectors.SECTORS) {
            if (TradingHours.isTrading("sector", s.market())) {
                codes.add(s.code());
                names.put(s.code(), s.name());
            }
        }
        for (YahooAsset.Symbol s : YahooAsset.COMMODITIES) {
            if (TradingHours.isTrading("commodity", s.market())) {
                codes.add(s.code());
                names.put(s.code(), s.name());
            }
        }
        for (YahooAsset.Symbol s : YahooAsset.FOREX) {
            if (TradingHours.isTrading("forex", s.market())) {
                codes.add(s.code());
                names.put(s.code(), s.name());
            }
        }
        for (YahooAsset.Symbol s : YahooAsset.CRYPTO) {
            if (TradingHours.isTrading("crypto", s.market())) {
                codes.add(s.code());
                names.put(s.code(), s.name());
            }
        }
        if (codes.isEmpty()) {
            log.info("[quote-snapshot] 当前无市场开市，跳过本轮刷新");
            return 0;
        }
        List<YahooKlineClient.BatchQuote> quotes = yahooKlineClient.getQuotes(codes);
        if (quotes.isEmpty()) return 0;
        List<QuoteSnapshot> snapshots = new ArrayList<>();
        for (YahooKlineClient.BatchQuote q : quotes) {
            // 防御：sidecar 偶发拉取失败会返回 0 值，跳过避免覆盖有效快照
            if (q.price() <= 0) {
                log.warn("[quote-snapshot] 跳过无效点位 {} price={}", q.symbol(), q.price());
                continue;
            }
            snapshots.add(new QuoteSnapshot(q.symbol(), names.getOrDefault(q.symbol(), q.symbol()),
                    q.price(), q.pctChange(), null));
        }
        if (snapshots.isEmpty()) {
            log.warn("[quote-snapshot] 本轮全部点位无效，保留旧快照");
            return 0;
        }
        quoteRepository.upsert(snapshots);
        log.info("[quote-snapshot] 刷新完成，{} 条", snapshots.size());
        return snapshots.size();
    }

    /** 指数列表（stock_info 元数据 + 实时快照点位，查询只读库） */
    public List<IndexQuote> listIndexQuotes() {
        return quoteRepository.queryIndexList();
    }

    /** 板块列表（stock_info 元数据 + 实时快照点位，按 market/board 分组，查询只读库）；market 为空返回全部 */
    public List<SectorQuote> listSectorQuotes(String market) {
        return quoteRepository.querySectorList(market);
    }

    /** 全球资产列表（商品/外汇/加密）：type 必传，market 可选过滤 */
    public List<AssetQuote> listAssetQuotes(String type, String market) {
        return quoteRepository.queryAssetList(type, market);
    }
}
