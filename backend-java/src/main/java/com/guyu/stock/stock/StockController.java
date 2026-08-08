package com.guyu.stock.stock;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.sina.Quote;
import com.guyu.stock.external.sina.SinaQuoteService;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/stock")
public class StockController {

    private final StockService stockService;
    private final SinaQuoteService sinaQuoteService;

    public StockController(StockService stockService, SinaQuoteService sinaQuoteService) {
        this.stockService = stockService;
        this.sinaQuoteService = sinaQuoteService;
    }

    @GetMapping("/search")
    public ApiResponse<Map<String, Object>> search(@RequestParam(value = "q", required = false) String q,
                                                   @RequestParam(value = "limit", defaultValue = "20") int limit) {
        if (q == null || q.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "q 参数必填");
        }
        return ApiResponse.success(stockService.search(q, limit));
    }

    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> getKlines(@PathVariable("code") String code,
                                                      @RequestParam(value = "scale", required = false) String scale,
                                                      @RequestParam(value = "count", defaultValue = "100") int count) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        }
        if (scale == null || scale.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "scale 参数必填，例如 ?scale=240");
        }
        // B 阶段：仅处理 DB 周期；分钟级/新浪回退放 C 阶段
        if (!StockService.isDbKline(scale)) {
            throw new BizException(ErrCode.INVALID_PARAM, "本阶段仅支持日线(scale=240)与周线(scale=1200)");
        }
        return ApiResponse.success(stockService.getKlines(code, scale, count));
    }

    @GetMapping("/{code}/quote")
    public ApiResponse<Quote> getQuote(@PathVariable("code") String code) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        }
        return ApiResponse.success(sinaQuoteService.getQuote(code));
    }

    @GetMapping("/quotes")
    public ApiResponse<List<Quote>> getQuotes(@RequestParam(value = "codes", required = false) String codesStr) {
        if (codesStr == null || codesStr.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "codes 参数必填，逗号分隔");
        }
        List<String> codes = Arrays.stream(codesStr.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
        if (codes.isEmpty()) {
            throw new BizException(ErrCode.INVALID_PARAM, "股票代码列表为空");
        }
        if (codes.size() > 50) {
            throw new BizException(ErrCode.INVALID_PARAM, "一次最多查询 50 只股票");
        }
        return ApiResponse.success(sinaQuoteService.getBatchQuotes(codes));
    }
}
