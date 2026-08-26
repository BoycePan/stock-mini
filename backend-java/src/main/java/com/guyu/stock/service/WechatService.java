package com.guyu.stock.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Service
public class WechatService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties appProperties;
    private final RestClient restClient;

    public WechatService(AppProperties appProperties) {
        this.appProperties = appProperties;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(10_000);
        this.restClient = RestClient.builder()
                .requestFactory(factory)
                .baseUrl("https://api.weixin.qq.com")
                .build();
    }

    /** 返回 {openid, session_key, unionid}，微信 errcode!=0 时抛 WX_LOGIN_FAIL。
     *  按来源（source）取对应小程序的 appid/secret；source 未配置时抛 INVALID_PARAM。
     *  微信接口 Content-Type 可能是 text/plain（body 仍是 JSON），不能直接 body(Map.class)，
     *  先按 String 读取再手动解析（对齐项目其他外部客户端）。 */
    public Map<String, Object> code2Session(String source, String code) {
        AppProperties.Wechat.App app = appProperties.getWechat().getApps().get(source);
        if (app == null || app.getAppId() == null || app.getAppSecret() == null) {
            throw new BizException(ErrCode.INVALID_PARAM, "未知的 source: " + source);
        }
        String body = restClient.get()
                .uri(uriBuilder -> uriBuilder.path("/sns/jscode2session")
                        .queryParam("appid", app.getAppId())
                        .queryParam("secret", app.getAppSecret())
                        .queryParam("js_code", code)
                        .queryParam("grant_type", "authorization_code")
                        .build())
                .retrieve()
                .body(String.class);
        Map<String, Object> resp;
        try {
            resp = MAPPER.readValue(body, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
        if (resp == null || resp.containsKey("errcode") && !"0".equals(String.valueOf(resp.get("errcode")))) {
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
        return resp;
    }
}
