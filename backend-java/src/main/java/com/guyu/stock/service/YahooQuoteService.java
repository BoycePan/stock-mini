package com.guyu.stock.service;

import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooIndices;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.model.QuoteSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 指数实时快照：定时任务批量拉最新点位覆盖落库 quote_snapshot；查询只读库。
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

    /** 批量拉全部指数最新点位并覆盖落库，返回更新条数 */
    public int refreshSnapshot() {
        List<String> codes = YahooIndices.INDICES.stream().map(YahooIndices.Symbol::code).toList();
        List<YahooKlineClient.BatchQuote> quotes = yahooKlineClient.getQuotes(codes);
        if (quotes.isEmpty()) return 0;
        Map<String, String> names = new HashMap<>();
        for (YahooIndices.Symbol s : YahooIndices.INDICES) {
            names.put(s.code(), s.name());
        }
        List<QuoteSnapshot> snapshots = new ArrayList<>();
        for (YahooKlineClient.BatchQuote q : quotes) {
            snapshots.add(new QuoteSnapshot(q.symbol(), names.getOrDefault(q.symbol(), q.symbol()),
                    q.price(), q.pctChange(), null));
        }
        quoteRepository.upsert(snapshots);
        log.info("[quote-snapshot] 刷新完成，{} 条", snapshots.size());
        return snapshots.size();
    }

    /** 指数列表（stock_info 元数据 + 实时快照点位，查询只读库） */
    public List<IndexQuote> listIndexQuotes() {
        return quoteRepository.queryIndexList();
    }
}
