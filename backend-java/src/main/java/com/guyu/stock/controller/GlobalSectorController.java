package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.external.yahoo.YahooSectors;
import com.guyu.stock.model.SectorQuote;
import com.guyu.stock.service.YahooQuoteService;
import com.guyu.stock.service.YahooSectorService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 全球板块（美股板块 ETF）数据接口：查询（列表/K线/实时行情）+ 拉取落库。
 * 与 /api/v1/index/* 平行；列表基于 quote_snapshot 实时快照（定时 60s 刷新）+ stock_info 的 board 分组（industry/theme）。
 */
@RestController
@RequestMapping("/api/v1/global-sector")
public class GlobalSectorController {

    private final YahooSectorService yahooSectorService;
    private final YahooQuoteService yahooQuoteService;

    public GlobalSectorController(YahooSectorService yahooSectorService, YahooQuoteService yahooQuoteService) {
        this.yahooSectorService = yahooSectorService;
        this.yahooQuoteService = yahooQuoteService;
    }

    /** 板块列表：stock_info 元数据 + 实时快照点位（60s 刷新）；market 不传返回全部，否则按市场过滤（如 us）。含 market/board 分组字段；trading=true 只返回当前开市的板块 */
    @GetMapping("/list")
    public ApiResponse<List<SectorQuote>> list(@RequestParam(value = "market", required = false) String market,
                                               @RequestParam(value = "trading", required = false) Boolean trading) {
        return ApiResponse.success(yahooQuoteService.listSectorQuotes(market, trading));
    }

    /** 板块 K线：DB 有则查库，无则经 sidecar 拉取落库并返回（带缓存防限流） */
    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> klines(@PathVariable("code") String code,
                                                   @RequestParam(value = "range", defaultValue = "1y") String range) {
        return ApiResponse.success(yahooSectorService.getKlines(code, range));
    }

    /** 板块实时行情（透传 sidecar /quote，10s 缓存） */
    @GetMapping("/{code}/quote")
    public ApiResponse<YahooKlineClient.Quote> quote(@PathVariable("code") String code) {
        return ApiResponse.success(yahooSectorService.getQuote(code));
    }

    /** 手动触发拉取全部板块 ETF 日线并落库 stock_kline（type='sector'） */
    @GetMapping("/fetch-sectors")
    public ApiResponse<Map<String, Object>> fetchSectors(
            @RequestParam(value = "range", defaultValue = "1y") String range) {
        int ok = yahooSectorService.fetchSectors(range);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("range", range);
        result.put("ok", ok);
        result.put("total", YahooSectors.SECTORS.size());
        return ApiResponse.success(result);
    }

    /** 手动触发把板块元数据登记到 stock_info（type='sector'，含 board 分类便于分组） */
    @GetMapping("/sync-info")
    public ApiResponse<Map<String, Object>> syncInfo() {
        int n = yahooSectorService.syncSectorInfo();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("synced", n);
        result.put("total", YahooSectors.SECTORS.size());
        return ApiResponse.success(result);
    }
}
