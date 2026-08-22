package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.RssSourceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

@RequestMapping("/api/mgr")
@RestController
public class MgrController {

    private final AppProperties.Mgr cfg;
    private final RssSourceService rssSourceService;

    public MgrController(AppProperties appProperties, RssSourceService rssSourceService) {
        this.cfg = appProperties.getMgr();
        this.rssSourceService = rssSourceService;
    }

    /**
     * 用户名密码登录（简单口令校验）：
     * 拼接 {@code 用户名@密码} 后做 base64，与 {@code app.mgr.admin-token} 比对；
     * 一致则返回该 base64 作为后续 {@code /api/mgr/**} 请求的 Bearer token。
     */
    @PostMapping("/login")
    public ApiResponse<String> login(@RequestBody LoginRequest req) {
        if (req == null || req.username() == null || req.username().isBlank()
                || req.password() == null || req.password().isBlank()) {
            return ApiResponse.error(ErrCode.INVALID_PARAM, "用户名或密码不能为空");
        }
        String raw = req.username() + "@" + req.password();
        String encoded = Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        if (encoded.equals(cfg.getAdminToken())) {
            return ApiResponse.success(encoded);
        }
        return ApiResponse.error(ErrCode.INVALID_PARAM, "用户名或密码错误");
    }

    // ---------------- RSS 数据源管理 ----------------

    /** 列表：includeDeleted=true 时包含软删源 */
    @GetMapping("/rss/sources")
    public ApiResponse<List<Map<String, Object>>> sources(
            @RequestParam(value = "includeDeleted", required = false, defaultValue = "false") boolean includeDeleted) {
        return ApiResponse.success(rssSourceService.list(includeDeleted));
    }

    /** 新增源 */
    @PostMapping("/rss/sources")
    public ApiResponse<Map<String, Object>> createSource(@RequestBody CreateRequest req) {
        boolean viaWorker = req.viaWorker() != null && req.viaWorker();
        boolean enabled = req.enabled() == null || req.enabled();
        return ApiResponse.success(rssSourceService.create(req.name(), req.url(), viaWorker, enabled));
    }

    /** 修改字段（name/url/viaWorker/enabled/deleted 只传要改的项），启停/软删/恢复都走这里 */
    @PutMapping("/rss/sources/{id}")
    public ApiResponse<Map<String, Object>> updateSource(@PathVariable("id") long id,
                                                         @RequestBody UpdateRequest req) {
        return ApiResponse.success(rssSourceService.update(id, req.name(), req.url(), req.viaWorker(),
                req.enabled(), req.deleted()));
    }

    /** 试抓：可达性 + 预览条目；id 与 url 二选一，saveStatus 控制是否回写状态 */
    @PostMapping("/rss/check")
    public ApiResponse<Map<String, Object>> check(@RequestBody CheckRequest req) {
        boolean saveStatus = req.saveStatus() != null && req.saveStatus();
        return ApiResponse.success(rssSourceService.check(req.id(), req.url(), req.viaWorker(),
                req.maxItems(), saveStatus));
    }

    public record LoginRequest(String username, String password) {}
    public record CreateRequest(String name, String url, Boolean viaWorker, Boolean enabled) {}
    public record UpdateRequest(String name, String url, Boolean viaWorker, Boolean enabled, Boolean deleted) {}
    public record CheckRequest(Long id, String url, Boolean viaWorker, Integer maxItems, Boolean saveStatus) {}
}
