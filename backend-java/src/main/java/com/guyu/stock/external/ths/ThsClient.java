package com.guyu.stock.external.ths;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;

import java.time.Duration;
import java.util.List;

public class ThsClient {

    private static final String BOARD_LIST_URL = "https://q.10jqka.com.cn/gn/";
    private static final String KLINE_URL = "https://d.10jqka.com.cn/v4/line/bk_%s/01/last.js";
    private static final String MEMBERS_URL = "http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/%d/";

    private final DataSource source;
    private final Cache<String, List<BoardInfo>> boardListCache;
    private final Cache<String, List<BoardKLine>> boardKlineCache;

    public ThsClient(DataSource source) {
        this(source, 1000);
    }

    public ThsClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        // Caffeine 3.x 的 Cache 没有 put(K,V,Duration) 重载，用 expireAfterWrite 实现固定 60s TTL，与 Go 侧一致。
        this.boardListCache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfterWrite(Duration.ofSeconds(60))
                .build();
        this.boardKlineCache = Caffeine.newBuilder()
                .maximumSize(cacheMaxSize)
                .expireAfterWrite(Duration.ofSeconds(60))
                .build();
    }

    public List<BoardInfo> fetchBoardList(int topN) {
        if (topN <= 0) topN = 60;
        List<BoardInfo> cached = boardListCache.getIfPresent("all");
        if (cached != null) return top(cached, topN);
        List<BoardInfo> boards = ThsParser.parseBoardList(source.getBytes(BOARD_LIST_URL));
        boards.sort((a, b) -> Double.compare(b.pctChg(), a.pctChg()));
        boardListCache.put("all", boards);
        return top(boards, topN);
    }

    public List<BoardKLine> fetchBoardKLine(String plateCode, int count) {
        if (count <= 0) count = 30;
        String key = plateCode + ":" + count;
        List<BoardKLine> cached = boardKlineCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(KLINE_URL, plateCode);
        List<BoardKLine> klines = ThsParser.parseBoardKLine(source.getBytes(url), count);
        boardKlineCache.put(key, klines);
        return klines;
    }

    public List<String> fetchMembers(int cid) {
        String url = String.format(MEMBERS_URL, cid);
        return ThsParser.parseMembers(source.getBytes(url));
    }

    private static <T> List<T> top(List<T> list, int n) {
        return n >= list.size() ? list : new java.util.ArrayList<>(list.subList(0, n));
    }
}
