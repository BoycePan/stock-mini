package com.guyu.stock.auth;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Service
public class WechatService {

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

    /** 返回 {openid, session_key, unionid}，微信 errcode!=0 时抛 WX_LOGIN_FAIL */
    public Map<String, Object> code2Session(String code) {
        Map<String, Object> resp = restClient.get()
                .uri(uriBuilder -> uriBuilder.path("/sns/jscode2session")
                        .queryParam("appid", appProperties.getWechat().getAppId())
                        .queryParam("secret", appProperties.getWechat().getAppSecret())
                        .queryParam("js_code", code)
                        .queryParam("grant_type", "authorization_code")
                        .build())
                .retrieve()
                .body(Map.class);
        if (resp == null || resp.containsKey("errcode") && !"0".equals(String.valueOf(resp.get("errcode")))) {
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
        return resp;
    }
}
