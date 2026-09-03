package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.WxAdService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 管理端：微信广告数据查询（/api/mgr/ad/stats，走 MgrAuthInterceptor 鉴权）。
 *
 * <p>查询 {@code wx_ad_daily_stat} 已落库的广告日统计（端 × 广告位类型 × 天），
 * 供管理后台看板/对账使用。金额返回元（incomeYuan），原始分与 ecpm 也一并返回。</p>
 */
@RestController
@RequestMapping("/api/mgr/ad")
public class MgrAdController {

    private final WxAdService wxAdService;

    public MgrAdController(WxAdService wxAdService) {
        this.wxAdService = wxAdService;
    }

    /**
     * 广告日统计查询。
     *
     * @param target  端（app.wechat.apps 的 key，如 shiChang-tracker），为空=全部端
     * @param from    起始日期（含），yyyy-MM-dd，可选
     * @param to      结束日期（含），yyyy-MM-dd，可选
     * @param adSlot  广告位类型枚举（如 SLOT_ID_WEAPP_COVER），可选
     */
    @GetMapping("/stats")
    public ApiResponse<List<Map<String, Object>>> stats(
            @RequestParam(value = "target", required = false) String target,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "adSlot", required = false) String adSlot) {
        LocalDate fromDate = parseDate(from, "from");
        LocalDate toDate = parseDate(to, "to");
        return ApiResponse.success(wxAdService.queryStats(target, fromDate, toDate, adSlot));
    }

    /**
     * 访问趋势（日活/日新增等基础数据）查询。
     *
     * @param target 端，为空=全部端
     * @param from   起始日期（含），yyyy-MM-dd，可选
     * @param to     结束日期（含），yyyy-MM-dd，可选
     */
    @GetMapping("/visit")
    public ApiResponse<List<Map<String, Object>>> visit(
            @RequestParam(value = "target", required = false) String target,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to) {
        LocalDate fromDate = parseDate(from, "from");
        LocalDate toDate = parseDate(to, "to");
        return ApiResponse.success(wxAdService.queryVisitStats(target, fromDate, toDate));
    }

    private LocalDate parseDate(String value, String field) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDate.parse(value.trim());
        } catch (Exception e) {
            throw new com.guyu.stock.common.BizException(com.guyu.stock.common.ErrCode.INVALID_PARAM,
                    field + " 不是合法日期（yyyy-MM-dd）: " + value);
        }
    }

    /**
     * 手动触发一次数据拉取（先刷 token，再拉广告数据 + 昨日访问趋势），返回各端拉取行数。
     * 联调/补数用：不依赖定时窗口，随时可调。
     *
     * @param from 起始日期（含），可选；缺省 = 近 lookbackDays 天（仅广告数据用）
     * @param to   结束日期（含），可选；缺省 = 今天（仅广告数据用）
     */
    @PostMapping("/pull")
    public ApiResponse<Map<String, Object>> pull(
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to) {
        LocalDate fromDate = parseDate(from, "from");
        LocalDate toDate = parseDate(to, "to");
        return ApiResponse.success(wxAdService.manualPullAll(fromDate, toDate));
    }
}
