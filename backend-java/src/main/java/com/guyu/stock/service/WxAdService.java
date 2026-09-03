package com.guyu.stock.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.WxAccessTokenRepository;
import com.guyu.stock.dao.WxAdDailyStatRepository;
import com.guyu.stock.dao.WxDailyVisitStatRepository;
import com.guyu.stock.model.WxAdDailyStat;
import com.guyu.stock.model.WxAccessToken;
import com.guyu.stock.model.WxDailyVisitStat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 微信广告数据（流量主）服务：token 刷新/读取 + 广告汇总数据拉取。
 *
 * <p>接口走老版流量主数据接口 {@code publisher/stat}（用小程序自身 access_token 直连，
 * 已实测可用）；汇总接口 {@code publisher_adpos_general} 返回「广告位类型 × 天」的
 * 拉取量/曝光/点击/收入等指标。金额单位为「分」，ecpm 为「分/千次曝光」。</p>
 */
@Service
public class WxAdService {

    private static final Logger log = LoggerFactory.getLogger(WxAdService.class);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties appProperties;
    private final WxAccessTokenRepository wxAccessTokenRepository;
    private final WxAdDailyStatRepository wxAdDailyStatRepository;
    private final WxDailyVisitStatRepository wxDailyVisitStatRepository;
    private final RestClient restClient;

    public WxAdService(AppProperties appProperties,
                       WxAccessTokenRepository wxAccessTokenRepository,
                       WxAdDailyStatRepository wxAdDailyStatRepository,
                       WxDailyVisitStatRepository wxDailyVisitStatRepository) {
        this.appProperties = appProperties;
        this.wxAccessTokenRepository = wxAccessTokenRepository;
        this.wxAdDailyStatRepository = wxAdDailyStatRepository;
        this.wxDailyVisitStatRepository = wxDailyVisitStatRepository;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(10_000);
        this.restClient = RestClient.builder()
                .requestFactory(factory)
                .baseUrl("https://api.weixin.qq.com")
                .build();
    }

    // ---------- token ----------

    /**
     * 为指定端刷新 access_token 并落库（调 /cgi-bin/token）。
     * 返回刷新后的凭证；失败抛异常（由调用方任务捕获记日志，单端失败不影响其他端）。
     */
    public WxAccessToken refreshToken(String source) {
        AppProperties.Wechat.App app = app(source);
        if (app.getAppSecret() == null || app.getAppSecret().isBlank()) {
            log.warn("[wx-ad] {} 未配置 app-secret，跳过 token 刷新", source);
            return null;
        }
        String body = restClient.get()
                .uri(uriBuilder -> uriBuilder.path("/cgi-bin/token")
                        .queryParam("grant_type", "client_credential")
                        .queryParam("appid", app.getAppId())
                        .queryParam("secret", app.getAppSecret())
                        .build())
                .retrieve()
                .body(String.class);
        Map<String, Object> resp = parseJson(body);
        Object token = resp.get("access_token");
        Object expiresIn = resp.get("expires_in");
        if (token == null || expiresIn == null) {
            throw new IllegalStateException("刷新 token 失败：响应无 access_token/expires_in，body=" + body);
        }
        long seconds = Long.parseLong(String.valueOf(expiresIn));
        Timestamp expiresAt = Timestamp.valueOf(LocalDateTime.now().plusSeconds(seconds));
        wxAccessTokenRepository.upsert(source, String.valueOf(token), expiresAt);
        log.info("[wx-ad] 刷新 {} 的 access_token，有效期至 {}", source, expiresAt);
        return wxAccessTokenRepository.findByTarget(source).orElse(null);
    }

    /** 读取某端最新 token（未刷新过则返回 empty） */
    public Optional<WxAccessToken> findToken(String source) {
        return wxAccessTokenRepository.findByTarget(source);
    }

    // ---------- 广告数据 ----------

    /**
     * 拉取某端 [from, to]（含端点）区间的广告汇总数据并 upsert 落库。
     * 返回写入行数。分页取全（page_size=90，按 total_num 判断是否还有下一页）。
     */
    public int pullDailyStat(String source, LocalDate from, LocalDate to) {
        AppProperties.Wechat.App app = app(source);
        Optional<WxAccessToken> tokenOpt = findToken(source);
        if (tokenOpt.isEmpty()) {
            log.warn("[wx-ad] {} 无可用 access_token，跳过拉取", source);
            return 0;
        }
        String token = tokenOpt.get().accessToken();

        int total = 0;
        int page = 1;
        int pageSize = 90;
        while (true) {
            JsonNode node = fetchAdposGeneral(token, page, pageSize, from, to);
            int ret = node.path("base_resp").path("ret").asInt(-1);
            if (ret != 0) {
                String errMsg = node.path("base_resp").path("err_msg").asText();
                throw new IllegalStateException("publisher_adpos_general 返回 ret=" + ret + ", err_msg=" + errMsg);
            }
            JsonNode list = node.path("list");
            int fetched = upsertRows(source, list);
            total += fetched;
            int totalNum = node.path("total_num").asInt(0);
            if (list.size() == 0 || page * pageSize >= totalNum) {
                break;
            }
            page++;
        }
        log.info("[wx-ad] {} 拉取广告汇总 {}~{} 共写入 {} 行", source, from, to, total);
        return total;
    }

    private JsonNode fetchAdposGeneral(String token, int page, int pageSize, LocalDate from, LocalDate to) {
        String body = restClient.get()
                .uri(uriBuilder -> uriBuilder.path("/publisher/stat")
                        .queryParam("action", "publisher_adpos_general")
                        .queryParam("access_token", token)
                        .queryParam("page", page)
                        .queryParam("page_size", pageSize)
                        .queryParam("start_date", from.toString())
                        .queryParam("end_date", to.toString())
                        .build())
                .retrieve()
                .body(String.class);
        try {
            return MAPPER.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("解析 publisher_adpos_general 响应失败: " + body, e);
        }
    }

    private int upsertRows(String target, JsonNode list) {
        if (list == null || !list.isArray()) return 0;
        List<WxAdDailyStat> rows = new ArrayList<>();
        for (JsonNode item : list) {
            String adSlot = item.path("ad_slot").asText(null);
            if (adSlot == null || adSlot.isBlank()) continue;
            String dateStr = item.path("date").asText(null);
            if (dateStr == null || dateStr.isBlank()) continue;
            Date statDate = Date.valueOf(dateStr);
            Long slotId = item.hasNonNull("slot_id") ? item.path("slot_id").asLong() : null;
            rows.add(new WxAdDailyStat(
                    0,
                    target,
                    statDate,
                    slotId,
                    adSlot,
                    slotName(adSlot),
                    item.path("req_succ_count").asLong(0),
                    item.path("exposure_count").asLong(0),
                    bigDecimal(item, "exposure_rate"),
                    item.path("click_count").asLong(0),
                    bigDecimal(item, "click_rate"),
                    item.path("income").asLong(0),
                    bigDecimal(item, "ecpm"),
                    null,
                    null));
        }
        return wxAdDailyStatRepository.batchUpsert(rows);
    }

    // ---------- 访问趋势（日活/日新增等基础数据） ----------

    /**
     * 拉取某端单日访问趋势（微信接口一次只能查 1 天，且最大昨日）并 upsert 落库。
     * 返回写入行数（0 或 1）。
     */
    public int pullDailyVisit(String source, LocalDate day) {
        Optional<WxAccessToken> tokenOpt = findToken(source);
        if (tokenOpt.isEmpty()) {
            log.warn("[wx-ad] {} 无可用 access_token，跳过访问趋势拉取", source);
            return 0;
        }
        String token = tokenOpt.get().accessToken();
        String payload;
        try {
            payload = MAPPER.writeValueAsString(Map.of(
                    "begin_date", day.toString().replace("-", ""),
                    "end_date", day.toString().replace("-", "")));
        } catch (Exception e) {
            throw new IllegalStateException("构造访问趋势请求体失败", e);
        }
        String body = restClient.post()
                .uri(uriBuilder -> uriBuilder.path("/datacube/getweanalysisappiddailyvisittrend")
                        .queryParam("access_token", token)
                        .build())
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(payload)
                .retrieve()
                .body(String.class);
        JsonNode node;
        try {
            node = MAPPER.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("解析访问趋势响应失败: " + body, e);
        }
        // 该接口错误时返回 errcode/errmsg（非 base_resp 结构）
        if (node.hasNonNull("errcode")) {
            int code = node.path("errcode").asInt(0);
            if (code != 0) {
                // 61503 = 微信侧数据还在计算中（通常上午 11 点前更新完），属于可预期的延迟，
                // 不算失败：返回 0（跳过），由定时任务下一轮再补。
                if (code == 61503) {
                    log.info("[wx-ad] {} 访问趋势 {} 微信侧尚未更新完毕（61503），跳过", source, day);
                    return 0;
                }
                throw new IllegalStateException("getweanalysisappiddailyvisittrend 返回 errcode="
                        + code + ", errmsg=" + node.path("errmsg").asText());
            }
        }
        JsonNode list = node.path("list");
        if (!list.isArray() || list.isEmpty()) {
            log.info("[wx-ad] {} 访问趋势 {} 无数据", source, day);
            return 0;
        }
        JsonNode item = list.get(0);
        WxDailyVisitStat row = new WxDailyVisitStat(
                0, source, Date.valueOf(day),
                item.path("session_cnt").asLong(0),
                item.path("visit_pv").asLong(0),
                item.path("visit_uv").asLong(0),
                item.path("visit_uv_new").asLong(0),
                nullableDouble(item, "stay_time_uv"),
                nullableDouble(item, "stay_time_session"),
                nullableDouble(item, "visit_depth"),
                null, null);
        return wxDailyVisitStatRepository.batchUpsert(List.of(row));
    }

    /** 管理端查询访问趋势：返回日活/日新增等字段 */
    public List<Map<String, Object>> queryVisitStats(String target, LocalDate from, LocalDate to) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (WxDailyVisitStat r : wxDailyVisitStatRepository.query(target, from, to)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id());
            m.put("target", r.target());
            m.put("statDate", r.statDate() == null ? null : r.statDate().toString());
            m.put("sessionCnt", r.sessionCnt());
            m.put("visitPv", r.visitPv());
            m.put("visitUv", r.visitUv());          // 日活
            m.put("visitUvNew", r.visitUvNew());    // 日新增
            m.put("stayTimeUv", r.stayTimeUv());
            m.put("stayTimeSession", r.stayTimeSession());
            m.put("visitDepth", r.visitDepth());
            m.put("pulledAt", r.pulledAt() == null ? null : r.pulledAt().toInstant().toString());
            result.add(m);
        }
        return result;
    }

    private static Double nullableDouble(JsonNode item, String field) {
        JsonNode n = item.get(field);
        if (n == null || n.isNull()) return null;
        try {
            return n.doubleValue();
        } catch (Exception e) {
            return null;
        }
    }

    /** 广告位类型枚举 → 中文名（微信接口不返回中文，代码内映射填 ad_slot_name） */
    private static String slotName(String adSlot) {
        return switch (adSlot) {
            case "SLOT_ID_WEAPP_BANNER" -> "Banner 广告";
            case "SLOT_ID_WEAPP_REWARD_VIDEO" -> "激励视频广告";
            case "SLOT_ID_WEAPP_INTERSTITIAL" -> "插屏广告";
            case "SLOT_ID_WEAPP_VIDEO_FEEDS" -> "视频广告";
            case "SLOT_ID_WEAPP_VIDEO_BEGIN" -> "视频贴片广告";
            case "SLOT_ID_WEAPP_COVER" -> "封面广告";
            case "SLOT_ID_WEAPP_BOX" -> "格子广告";
            case "SLOT_ID_WEAPP_TEMPLATE" -> "原生模板广告";
            default -> adSlot; // 未知枚举兜底：存原值，避免丢数据
        };
    }

    /**
     * 手动触发：遍历所有端，先刷新 token 再拉广告数据（from/to 为空时用默认窗口近 lookbackDays 天），
     * 同时拉昨日访问趋势（日活/日新增）。逐端独立 try/catch，返回每端结果与汇总。
     */
    public Map<String, Object> manualPullAll(LocalDate from, LocalDate to) {
        AppProperties.Wechat.Ad cfg = appProperties.getWechat().getAd();
        LocalDate effTo = to == null ? LocalDate.now() : to;
        LocalDate effFrom = from == null ? effTo.minusDays(Math.max(0, cfg.getLookbackDays() - 1)) : from;
        LocalDate yesterday = LocalDate.now().minusDays(1);

        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> sources = new ArrayList<>();
        int totalRows = 0;
        int failed = 0;
        for (String source : appProperties.getWechat().getApps().keySet()) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("source", source);
            AppProperties.Wechat.App app = appProperties.getWechat().getApps().get(source);
            if (app == null || app.getAppSecret() == null || app.getAppSecret().isBlank()) {
                d.put("skipped", "未配置 app-secret");
                sources.add(d);
                continue;
            }
            try {
                refreshToken(source);
                int rows = pullDailyStat(source, effFrom, effTo);
                d.put("adRows", rows);
                totalRows += rows;
                int visitRows = pullDailyVisit(source, yesterday);
                d.put("visitRows", visitRows);
                totalRows += visitRows;
            } catch (Exception e) {
                d.put("error", e.getMessage());
                failed++;
            }
            sources.add(d);
        }
        result.put("from", effFrom.toString());
        result.put("to", effTo.toString());
        result.put("totalRows", totalRows);
        result.put("failed", failed);
        result.put("sources", sources);
        return result;
    }

    // ---------- 管理端查询 ----------

    /**
     * 按端 + 日期区间 + 可选广告位类型查询已落库的广告日统计。
     * 返回管理端友好结构：金额分 → 元、率保留原小数。
     */
    public List<Map<String, Object>> queryStats(String target, LocalDate from, LocalDate to, String adSlot) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (WxAdDailyStat r : wxAdDailyStatRepository.query(target, from, to, adSlot)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id());
            m.put("target", r.target());
            m.put("statDate", r.statDate() == null ? null : r.statDate().toString());
            m.put("adSlot", r.adSlot());
            m.put("adSlotName", r.adSlotName());
            m.put("reqSuccCount", r.reqSuccCount());
            m.put("exposureCount", r.exposureCount());
            m.put("exposureRate", r.exposureRate());
            m.put("clickCount", r.clickCount());
            m.put("clickRate", r.clickRate());
            m.put("incomeFen", r.incomeFen());
            // 分 → 元（保留 2 位），管理端直接展示
            m.put("incomeYuan", fenToYuan(r.incomeFen()));
            m.put("ecpmFen", r.ecpmFen());
            m.put("pulledAt", r.pulledAt() == null ? null : r.pulledAt().toInstant().toString());
            result.add(m);
        }
        return result;
    }

    private static java.math.BigDecimal fenToYuan(long fen) {
        return java.math.BigDecimal.valueOf(fen, 2);
    }

    private static BigDecimal bigDecimal(JsonNode item, String field) {
        JsonNode n = item.get(field);
        if (n == null || n.isNull()) return BigDecimal.ZERO;
        try {
            return n.decimalValue();
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    private AppProperties.Wechat.App app(String source) {
        AppProperties.Wechat.App app = appProperties.getWechat().getApps().get(source);
        if (app == null || app.getAppId() == null || app.getAppId().isBlank()) {
            throw new IllegalStateException("未配置 source=" + source + " 的 appid/secret");
        }
        return app;
    }

    private static Map<String, Object> parseJson(String body) {
        try {
            return MAPPER.readValue(body, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("解析微信响应失败: " + body, e);
        }
    }
}
