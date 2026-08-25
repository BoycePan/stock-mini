package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.model.TrackEvent;
import com.guyu.stock.service.TrackService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 用户行为打点上报（前端埋点批量上报，见 docs/埋点打点方案.md）。
 *
 * <p>路径 {@code /api/v1/track/events} 由 {@code OptionalAuthInterceptor} 拦截：
 * 携带有效 {@code Authorization: Bearer <token>} 时解析出 {@code user_id}，
 * 未携带（或无效）也放行，{@code user_id} 记 null（匿名行为）。
 */
@RestController
@RequestMapping("/api/v1/track")
public class TrackController {

    private final TrackService trackService;

    public TrackController(TrackService trackService) {
        this.trackService = trackService;
    }

    public record ReportRequest(List<TrackEvent> events) {}

    @PostMapping("/events")
    public ApiResponse<Map<String, Object>> report(HttpServletRequest request, @RequestBody ReportRequest req) {
        Long userId = (Long) request.getAttribute("user_id");
        String ip = clientIp(request);
        return ApiResponse.success(trackService.ingest(req == null ? null : req.events(), userId, ip));
    }

    /** 优先取 X-Forwarded-For 第一个 IP（nginx 反代场景），否则直连地址（与 RequestLogFilter 一致） */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return comma > 0 ? forwarded.substring(0, comma).trim() : forwarded.trim();
        }
        return request.getRemoteAddr();
    }
}
