package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.yahoo.YahooAsset;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.AssetQuote;
import com.guyu.stock.service.YahooAssetService;
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
 * 全球资产数据接口（商品/外汇/加密）：type 区分 commodity/forex/crypto。
 * 查询（列表/K线/实时行情）+ 拉取落库；列表基于 quote_snapshot 实时快照（定时 60s 刷新）。
 */
@RestController
@RequestMapping("/api/v1/asset")
public class GlobalAssetController {

    private final YahooAssetService yahooAssetService;
    private final YahooQuoteService yahooQuoteService;

    public GlobalAssetController(YahooAssetService yahooAssetService, YahooQuoteService yahooQuoteService) {
        this.yahooAssetService = yahooAssetService;
        this.yahooQuoteService = yahooQuoteService;
    }

    /** 资产列表：stock_info 元数据 + 实时快照点位；type 必传，market 可选过滤 */
    @GetMapping("/list")
    public ApiResponse<List<AssetQuote>> list(@RequestParam("type") String type,
                                              @RequestParam(value = "market", required = false) String market) {
        resolve(type); // 校验 type 合法性
        return ApiResponse.success(yahooQuoteService.listAssetQuotes(storageType(type), market));
    }

    /** 资产 K线：DB 有则查库，无则经 sidecar 拉取落库并返回（带缓存防限流） */
    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> klines(@PathVariable("code") String code,
                                                   @RequestParam(value = "range", defaultValue = "1y") String range) {
        return ApiResponse.success(yahooAssetService.getKlines(code, range));
    }

    /** 资产实时行情（透传 sidecar /quote，10s 缓存） */
    @GetMapping("/{code}/quote")
    public ApiResponse<YahooKlineClient.Quote> quote(@PathVariable("code") String code) {
        return ApiResponse.success(yahooAssetService.getQuote(code));
    }

    /** 手动触发拉取一类资产日线并落库 stock_kline（type 区分 commodity/forex/crypto/bond/stock） */
    @GetMapping("/fetch")
    public ApiResponse<Map<String, Object>> fetch(@RequestParam("type") String type,
                                                  @RequestParam(value = "range", defaultValue = "1y") String range) {
        List<YahooAsset.Symbol> symbols = resolve(type);
        int ok = yahooAssetService.fetchAssets(symbols, storageType(type), range);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("range", range);
        result.put("ok", ok);
        result.put("total", symbols.size());
        return ApiResponse.success(result);
    }

    /** 手动触发把一类资产元数据登记到 stock_info */
    @GetMapping("/sync-info")
    public ApiResponse<Map<String, Object>> syncInfo(@RequestParam("type") String type) {
        List<YahooAsset.Symbol> symbols = resolve(type);
        int n = yahooAssetService.syncAssetInfo(symbols, storageType(type));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("synced", n);
        result.put("total", symbols.size());
        return ApiResponse.success(result);
    }

    /** type → 清单映射，非法 type 抛参数错误 */
    private List<YahooAsset.Symbol> resolve(String type) {
        if (type == null || type.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "type 不能为空");
        }
        return switch (type) {
            case "commodity" -> YahooAsset.COMMODITIES;
            case "forex" -> YahooAsset.FOREX;
            case "crypto" -> YahooAsset.CRYPTO;
            case "bond" -> YahooAsset.BONDS;
            case "stock" -> YahooAsset.STOCKS;
            default -> throw new BizException(ErrCode.INVALID_PARAM, "未知 type: " + type);
        };
    }

    /** API type → 存储 type：美股个股用 us-stock，避免与 A股（type='stock'）冲突 */
    private String storageType(String type) {
        return "stock".equals(type) ? "us-stock" : type;
    }
}
