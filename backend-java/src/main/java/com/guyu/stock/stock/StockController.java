package com.guyu.stock.stock;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/stock")
public class StockController {

    private final StockService stockService;

    public StockController(StockService stockService) {
        this.stockService = stockService;
    }

    @GetMapping("/search")
    public ApiResponse<Map<String, Object>> search(@RequestParam("q") String q,
                                                   @RequestParam(value = "limit", defaultValue = "20") int limit) {
        if (q == null || q.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "q 参数必填");
        }
        return ApiResponse.success(stockService.search(q, limit));
    }

    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> getKlines(@PathVariable("code") String code,
                                                      @RequestParam("scale") String scale,
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
}
