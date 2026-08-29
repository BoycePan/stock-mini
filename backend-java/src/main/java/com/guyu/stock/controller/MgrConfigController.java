package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.AppConfigService;
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
 * 管理端：前端展示配置 CRUD（/api/mgr/configs，走 MgrAuthInterceptor 鉴权）。
 *
 * <p>树形结构：nodeType=group（分组，可挂子项）/ item（配置项，有值）；
 * parentId 表达父子关系（null=顶层/单独项）。
 * 交付类型 cfgType：login（登录下发）/ display（前端渲染读取）/ other（其他）。
 */
@RestController
@RequestMapping("/api/mgr")
public class MgrConfigController {

    /** 新增/更新请求体（PUT 部分字段：未传的保持原值） */
    public record ConfigRequest(
            Long parentId,
            String nodeType,
            String cfgType,
            String cfgKey,
            String cfgValue,
            String remark,
            String target,
            Integer sort,
            Boolean enabled) {}

    private final AppConfigService appConfigService;

    public MgrConfigController(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    /** 全量平铺列表（含 id/parentId，前端自建树） */
    @GetMapping("/configs")
    public ApiResponse<List<Map<String, Object>>> list() {
        return ApiResponse.success(appConfigService.list());
    }

    /** 新增分组或配置项 */
    @PostMapping("/configs")
    public ApiResponse<Map<String, Object>> create(@RequestBody ConfigRequest req) {
        return ApiResponse.success(appConfigService.create(
                req.parentId(), req.nodeType(), req.cfgType(), req.cfgKey(), req.cfgValue(),
                req.remark(), req.target(), req.sort(), req.enabled()));
    }

    /**
     * 更新（部分字段）。parentId 约定：0=移动到顶层（parent_id 置 NULL），&gt;0=挂到该分组下。
     */
    @PutMapping("/configs/{id}")
    public ApiResponse<Map<String, Object>> update(@PathVariable("id") long id,
                                                   @RequestBody ConfigRequest req) {
        return ApiResponse.success(appConfigService.update(
                id, req.parentId(), req.nodeType(), req.cfgType(), req.cfgKey(), req.cfgValue(),
                req.remark(), req.target(), req.sort(), req.enabled()));
    }

    /** 删除（分组下还有子项时返回 400） */
    @DeleteMapping("/configs/{id}")
    public ApiResponse<Void> delete(@PathVariable("id") long id) {
        appConfigService.delete(id);
        return ApiResponse.ok();
    }
}
