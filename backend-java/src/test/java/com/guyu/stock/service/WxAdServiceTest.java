package com.guyu.stock.service;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.WxAccessTokenRepository;
import com.guyu.stock.dao.WxAdDailyStatRepository;
import com.guyu.stock.dao.WxDailyVisitStatRepository;
import com.guyu.stock.model.WxAccessToken;
import com.guyu.stock.model.WxAdDailyStat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * WxAdService 广告/趋势拉取单测：重点覆盖「未开通流量主（无广告数据权限）」的识别与跳过语义——
 * {@code publisher/stat} 返回 {@code base_resp.ret=-1 且 err_msg 空}（2026-09-04 hangQing-tracker 实测签名）
 * 或文档错误码 2009/1807 时，跳过该端广告拉取：不抛异常、不落库、定时/手动均不再视为失败；
 * 手动拉取中广告与访问趋势解耦互不影响。
 */
class WxAdServiceTest {

    private static final String SHICHANG = "shiChang-tracker";
    private static final String HANGQING = "hangQing-tracker";
    private static final String API = "https://api.weixin.qq.com";

    private final WxAccessTokenRepository tokenRepository = mock(WxAccessTokenRepository.class);
    private final WxAdDailyStatRepository adRepository = mock(WxAdDailyStatRepository.class);
    private final WxDailyVisitStatRepository visitRepository = mock(WxDailyVisitStatRepository.class);

    private AppProperties appProperties;
    private MockRestServiceServer server;
    private WxAdService service;

    @BeforeEach
    void setUp() {
        appProperties = new AppProperties();
        AppProperties.Wechat wechat = new AppProperties.Wechat();
        AppProperties.Wechat.Ad ad = new AppProperties.Wechat.Ad();
        ad.setLookbackDays(3);
        wechat.setAd(ad);
        AppProperties.Wechat.App shiChang = new AppProperties.Wechat.App();
        shiChang.setAppId("wx2cfd1556edf21a24");
        shiChang.setAppSecret("shichang-secret");
        AppProperties.Wechat.App hangQing = new AppProperties.Wechat.App();
        hangQing.setAppId("wx0ecd2049e54fbca8");
        hangQing.setAppSecret("hangqing-secret");
        wechat.setApps(new LinkedHashMap<>());
        wechat.getApps().put(SHICHANG, shiChang);
        wechat.getApps().put(HANGQING, hangQing);
        appProperties.setWechat(wechat);

        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        service = new WxAdService(appProperties, tokenRepository, adRepository, visitRepository, builder);
    }

    private void stubToken(String source, String token) {
        when(tokenRepository.findByTarget(source))
                .thenReturn(Optional.of(new WxAccessToken(
                        1, source, token,
                        Timestamp.valueOf(LocalDateTime.now().plusHours(1)), null, null)));
    }

    private String adStatUrl(String token, LocalDate from, LocalDate to) {
        return API + "/publisher/stat?action=publisher_adpos_general&access_token=" + token
                + "&page=1&page_size=90&start_date=" + from + "&end_date=" + to;
    }

    private static String okBody(String list) {
        return "{\"base_resp\":{\"err_msg\":\"ok\",\"ret\":0},\"list\":" + list + ",\"total_num\":1}";
    }

    private static String coverRowJson() {
        return "[{\"slot_id\":3030046789020061,\"ad_slot\":\"SLOT_ID_WEAPP_COVER\",\"date\":\"2026-09-02\","
                + "\"req_succ_count\":10,\"exposure_count\":100,\"exposure_rate\":0.5,\"click_count\":5,"
                + "\"click_rate\":0.05,\"income\":100,\"ecpm\":100.0}]";
    }

    // ---------- 未开通流量主：跳过且不视为失败 ----------

    @Test
    void adPull_retMinus1WithEmptyErrMsg_skipsWithoutFailure() {
        stubToken(SHICHANG, "TOKEN");
        LocalDate from = LocalDate.of(2026, 9, 2);
        LocalDate to = LocalDate.of(2026, 9, 4);
        server.expect(requestTo(adStatUrl("TOKEN", from, to)))
                .andRespond(withSuccess("{\"base_resp\":{\"ret\":-1,\"err_msg\":\"\"},\"list\":[],\"total_num\":0}",
                        MediaType.APPLICATION_JSON));

        WxAdService.AdPullResult result = service.pullDailyStatDetailed(SHICHANG, from, to);

        assertEquals(0, result.rows());
        assertNotNull(result.skipReason());
        verify(adRepository, never()).batchUpsert(anyList());
        server.verify();
    }

    @Test
    void adPull_documentedCode2009_skipsWithoutFailure() {
        stubToken(SHICHANG, "TOKEN");
        LocalDate from = LocalDate.of(2026, 9, 2);
        LocalDate to = LocalDate.of(2026, 9, 4);
        server.expect(requestTo(adStatUrl("TOKEN", from, to)))
                .andRespond(withSuccess("{\"base_resp\":{\"ret\":2009,\"err_msg\":\"invalid publisher\"},"
                        + "\"list\":[],\"total_num\":0}", MediaType.APPLICATION_JSON));

        int rows = service.pullDailyStat(SHICHANG, from, to);

        assertEquals(0, rows);
        verify(adRepository, never()).batchUpsert(anyList());
        server.verify();
    }

    @Test
    void adPull_realPublisherError_stillThrows() {
        stubToken(SHICHANG, "TOKEN");
        LocalDate from = LocalDate.of(2026, 9, 2);
        LocalDate to = LocalDate.of(2026, 9, 4);
        server.expect(requestTo(adStatUrl("TOKEN", from, to)))
                .andRespond(withSuccess("{\"base_resp\":{\"ret\":45010,\"err_msg\":\"invalid action\"},"
                        + "\"list\":[],\"total_num\":0}", MediaType.APPLICATION_JSON));

        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                () -> service.pullDailyStat(SHICHANG, from, to));
        verify(adRepository, never()).batchUpsert(anyList());
        server.verify();
    }

    // ---------- 已开通流量主：正常拉取落库 ----------

    @Test
    void adPull_ret0_writesRowsAndMapsSlotName() {
        stubToken(SHICHANG, "TOKEN");
        LocalDate from = LocalDate.of(2026, 9, 2);
        LocalDate to = LocalDate.of(2026, 9, 4);
        when(adRepository.batchUpsert(anyList())).thenReturn(1);
        server.expect(requestTo(adStatUrl("TOKEN", from, to)))
                .andRespond(withSuccess(okBody(coverRowJson()), MediaType.APPLICATION_JSON));

        int rows = service.pullDailyStat(SHICHANG, from, to);

        assertEquals(1, rows);
        verify(adRepository).batchUpsert(argThat(list -> {
            if (list.size() != 1) {
                return false;
            }
            WxAdDailyStat r = list.get(0);
            return SHICHANG.equals(r.target())
                    && "SLOT_ID_WEAPP_COVER".equals(r.adSlot())
                    && "封面广告".equals(r.adSlotName())
                    && 100 == r.incomeFen()
                    && java.sql.Date.valueOf("2026-09-02").equals(r.statDate());
        }));
        server.verify();
    }

    // ---------- 手动拉取：广告跳过/失败不影响同端趋势；未开通流量主不算失败 ----------

    @Test
    void manualPull_notPublisherEndSkipsAdButStillPullsVisit() {
        stubToken(SHICHANG, "TOK_A");
        stubToken(HANGQING, "TOK_H");
        LocalDate today = LocalDate.now();
        LocalDate fromDefault = today.minusDays(2);
        LocalDate yesterday = today.minusDays(1);
        String yCompact = yesterday.toString().replace("-", "");

        // shiChang-tracker（已开通流量主）：刷 token → 广告 ret:0 → 昨日趋势成功
        server.expect(requestTo(API + "/cgi-bin/token?grant_type=client_credential"
                        + "&appid=wx2cfd1556edf21a24&secret=shichang-secret"))
                .andRespond(withSuccess("{\"access_token\":\"TOK_A_NEW\",\"expires_in\":7200}",
                        MediaType.APPLICATION_JSON));
        server.expect(requestTo(adStatUrl("TOK_A", fromDefault, today)))
                .andRespond(withSuccess(okBody(coverRowJson()), MediaType.APPLICATION_JSON));
        server.expect(requestTo(API + "/datacube/getweanalysisappiddailyvisittrend?access_token=TOK_A"))
                .andExpect(content().json(
                        "{\"begin_date\":\"" + yCompact + "\",\"end_date\":\"" + yCompact + "\"}", false))
                .andRespond(withSuccess("{\"list\":[{\"session_cnt\":10,\"visit_pv\":20,\"visit_uv\":30,"
                        + "\"visit_uv_new\":5,\"stay_time_uv\":1.5,\"stay_time_session\":2.5,"
                        + "\"visit_depth\":3.0}]}", MediaType.APPLICATION_JSON));

        // hangQing-tracker（未开通流量主）：刷 token → 广告 ret=-1 跳过 → 昨日趋势 61503（计算中）按 0 行，不算失败
        server.expect(requestTo(API + "/cgi-bin/token?grant_type=client_credential"
                        + "&appid=wx0ecd2049e54fbca8&secret=hangqing-secret"))
                .andRespond(withSuccess("{\"access_token\":\"TOK_H_NEW\",\"expires_in\":7200}",
                        MediaType.APPLICATION_JSON));
        server.expect(requestTo(adStatUrl("TOK_H", fromDefault, today)))
                .andRespond(withSuccess("{\"base_resp\":{\"ret\":-1,\"err_msg\":\"\"},\"list\":[],\"total_num\":0}",
                        MediaType.APPLICATION_JSON));
        server.expect(requestTo(API + "/datacube/getweanalysisappiddailyvisittrend?access_token=TOK_H"))
                .andExpect(content().json(
                        "{\"begin_date\":\"" + yCompact + "\",\"end_date\":\"" + yCompact + "\"}", false))
                .andRespond(withSuccess("{\"errcode\":61503,\"errmsg\":\"data computing\"}",
                        MediaType.APPLICATION_JSON));

        when(adRepository.batchUpsert(anyList())).thenReturn(1);
        when(visitRepository.batchUpsert(anyList())).thenReturn(1);

        Map<String, Object> result = service.manualPullAll(null, null);

        // 写入：shiChang 广告 1 + 趋势 1；hangQing 广告跳过、趋势 61503 返回 0 → totalRows=2，failed=0
        assertEquals(2, result.get("totalRows"));
        assertEquals(0, result.get("failed"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> sources = (List<Map<String, Object>>) result.get("sources");
        Map<String, Object> shiChang = find(sources, SHICHANG);
        Map<String, Object> hangQing = find(sources, HANGQING);

        // shiChang：正常全量
        assertEquals(1, ((Number) shiChang.get("adRows")).intValue());
        assertEquals(1, ((Number) shiChang.get("visitRows")).intValue());
        assertFalse(shiChang.containsKey("adSkipped"));
        assertFalse(shiChang.containsKey("error"));

        // hangQing：广告跳过（非失败），趋势尝试过但无数据 → 不报错
        assertNull(hangQing.get("adRows"));
        assertNotNull(hangQing.get("adSkipped"));
        assertFalse(hangQing.containsKey("adError"));
        assertFalse(hangQing.containsKey("visitError"));
        assertFalse(hangQing.containsKey("error"));
        assertEquals(0, ((Number) hangQing.get("visitRows")).intValue());

        verify(visitRepository).batchUpsert(anyList());
        server.verify();
    }

    private static Map<String, Object> find(List<Map<String, Object>> sources, String source) {
        return sources.stream().filter(m -> source.equals(m.get("source"))).findFirst().orElseThrow();
    }
}
