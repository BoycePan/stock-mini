package com.guyu.stock.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.sina.Quote;
import com.guyu.stock.external.sina.SinaClient;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;

@Service
public class SinaQuoteService {

    private static final Duration TTL = Duration.ofSeconds(3);

    private final SinaClient client;
    private final Cache<String, Quote> quoteCache;
    private final Cache<String, List<Quote>> batchCache;

    public SinaQuoteService(SinaClient client) {
        this.client = client;
        this.quoteCache = Caffeine.newBuilder().expireAfterWrite(TTL).build();
        this.batchCache = Caffeine.newBuilder().expireAfterWrite(TTL).build();
    }

    public Quote getQuote(String code) {
        Quote cached = quoteCache.getIfPresent(code);
        if (cached != null) return cached;

        List<Quote> quotes = client.fetchQuotes(List.of(code));
        if (quotes.isEmpty()) {
            throw new BizException(ErrCode.SERVER_ERROR, "未找到 " + code + " 的行情数据");
        }
        Quote q = quotes.get(0);
        quoteCache.put(code, q);
        return q;
    }

    public List<Quote> getBatchQuotes(List<String> codes) {
        List<String> sorted = codes.stream().sorted().toList();
        String key = String.join(",", sorted);
        List<Quote> cached = batchCache.getIfPresent(key);
        if (cached != null) return cached;

        List<Quote> quotes = client.fetchQuotes(codes);
        batchCache.put(key, quotes);
        return quotes;
    }
}
