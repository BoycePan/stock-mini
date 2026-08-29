package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.service.AppConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 公开端：前端展示配置读取（/api/v1/configs，走 AuthInterceptor 鉴权）。
 *
 * <p>按交付类型返回摊平后的 JSON 对象：分组→嵌套对象，单独项→顶层键；
 * target='all' 兜底，指定 source 覆盖。source 缺省时使用默认来源小程序。
 */
@RestController
@RequestMapping("/api/v1")
public class PublicConfigController {

    private final AppConfigService appConfigService;
    private final AppProperties appProperties;

    public PublicConfigController(AppConfigService appConfigService, AppProperties appProperties) {
        this.appConfigService = appConfigService;
        this.appProperties = appProperties;
    }

    @GetMapping("/configs")
    public ApiResponse<Map<String, Object>> configs(
            @RequestParam(value = "source", required = false) String source,
            @RequestParam(value = "cfgType", required = false, defaultValue = "display") String cfgType) {
        String resolved = (source == null || source.isBlank())
                ? appProperties.getWechat().getDefaultSource()
                : source;
        return ApiResponse.success(appConfigService.deliveryMap(resolved, cfgType));
    }
}
