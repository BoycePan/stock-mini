package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.NoticeService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 公开端：前端公告读取（/api/v1/notices，走 AuthInterceptor 鉴权）。
 *
 * <p>返回启用的、命中分端、当前时间在有效期内的公告，按 pinned DESC, sort ASC 排序；
 * position 缺省时返回该端全部位置。source 缺省时使用默认来源小程序。
 */
@RestController
@RequestMapping("/api/v1")
public class PublicNoticeController {

    private final NoticeService noticeService;
    private final AppProperties appProperties;

    public PublicNoticeController(NoticeService noticeService, AppProperties appProperties) {
        this.noticeService = noticeService;
        this.appProperties = appProperties;
    }

    @GetMapping("/notices")
    public ApiResponse<List<Map<String, Object>>> notices(
            @RequestParam(value = "source", required = false) String source,
            @RequestParam(value = "position", required = false) String position) {
        String resolved = (source == null || source.isBlank())
                ? appProperties.getWechat().getDefaultSource()
                : source;
        return ApiResponse.success(noticeService.listPublic(resolved, position));
    }
}
