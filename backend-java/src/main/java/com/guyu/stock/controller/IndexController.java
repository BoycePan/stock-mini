package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.external.yahoo.YahooIndices;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.service.YahooIndexService;
import com.guyu.stock.service.YahooQuoteService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 指数数据接口：查询（列表/K线/实时行情）+ 拉取落库。
 * 列表基于 quote_snapshot 实时快照（定时 60s 刷新）+ stock_info 的 market 分组。
 */
@RestController
@RequestMapping("/api/v1/index")
public class IndexController {

    private final YahooIndexService yahooIndexService;
    private final YahooQuoteService yahooQuoteService;

    public IndexController(YahooIndexService yahooIndexService, YahooQuoteService yahooQuoteService) {
        this.yahooIndexService = yahooIndexService;
        this.yahooQuoteService = yahooQuoteService;
    }

    /** 指数列表：stock_info 元数据 + 实时快照点位（60s 刷新，含 market 分组） */
    @GetMapping("/list")
    public ApiResponse<List<IndexQuote>> list() {
        return ApiResponse.success(yahooQuoteService.listIndexQuotes());
    }

    /** 指数 K线：DB 有则查库，无则经 sidecar 拉取落库并返回（带缓存防限流） */
    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> klines(@PathVariable("code") String code,
                                                   @RequestParam(value = "range", defaultValue = "1y") String range) {
        return ApiResponse.success(yahooIndexService.getKlines(code, range));
    }

    /** 指数实时行情（透传 sidecar /quote，10s 缓存） */
    @GetMapping("/{code}/quote")
    public ApiResponse<YahooKlineClient.Quote> quote(@PathVariable("code") String code) {
        return ApiResponse.success(yahooIndexService.getQuote(code));
    }

    /** 手动触发拉取全球主要指数日线并落库 stock_kline（type='index'） */
    @GetMapping("/fetch-indices")
    public ApiResponse<Map<String, Object>> fetchIndices(
            @RequestParam(value = "range", defaultValue = "1y") String range) {
        int ok = yahooIndexService.fetchIndices(range);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("range", range);
        result.put("ok", ok);
        result.put("total", YahooIndices.INDICES.size());
        return ApiResponse.success(result);
    }

    /** 手动触发把指数元数据登记到 stock_info（type='index'，含 market 便于分组） */
    @GetMapping("/sync-info")
    public ApiResponse<Map<String, Object>> syncInfo() {
        int n = yahooIndexService.syncIndexInfo();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("synced", n);
        result.put("total", YahooIndices.INDICES.size());
        return ApiResponse.success(result);
    }
}
