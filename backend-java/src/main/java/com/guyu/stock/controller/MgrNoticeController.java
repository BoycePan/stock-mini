package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.NoticeService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 管理端：前端公告 CRUD（/api/mgr/notices，走 MgrAuthInterceptor 鉴权）。
 *
 * <p>type：notice / banner / marquee（可扩展）；target 分端；position 展示位置；
 * validFrom/validTo 为 ISO 时间字符串（东8区）；config 为 type 特有内容的 JSON 文本。
 */
@RestController
@RequestMapping("/api/mgr")
public class MgrNoticeController {

    /** 新增/更新请求体（PUT 部分字段：未传的保持原值） */
    public record NoticeRequest(
            String type,
            String title,
            String target,
            String position,
            Integer sort,
            Boolean pinned,
            Boolean enabled,
            String validFrom,
            String validTo,
            String config) {}

    private final NoticeService noticeService;

    public MgrNoticeController(NoticeService noticeService) {
        this.noticeService = noticeService;
    }

    /** 全量列表（config 返回 JSON 原文，便于管理端编辑） */
    @GetMapping("/notices")
    public ApiResponse<List<Map<String, Object>>> list() {
        return ApiResponse.success(noticeService.list());
    }

    @PostMapping("/notices")
    public ApiResponse<Map<String, Object>> create(@RequestBody NoticeRequest req) {
        return ApiResponse.success(noticeService.create(
                req.type(), req.title(), req.target(), req.position(), req.sort(),
                req.pinned(), req.enabled(), req.validFrom(), req.validTo(), req.config()));
    }

    @PutMapping("/notices/{id}")
    public ApiResponse<Map<String, Object>> update(@PathVariable("id") long id,
                                                   @RequestBody NoticeRequest req) {
        return ApiResponse.success(noticeService.update(
                id, req.type(), req.title(), req.target(), req.position(), req.sort(),
                req.pinned(), req.enabled(), req.validFrom(), req.validTo(), req.config()));
    }

    @DeleteMapping("/notices/{id}")
    public ApiResponse<Void> delete(@PathVariable("id") long id) {
        noticeService.delete(id);
        return ApiResponse.ok();
    }
}
