package com.guyu.stock.external;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.Encoders;
import com.guyu.stock.external.ths.BoardInfo;
import com.guyu.stock.external.ths.BoardKLine;
import com.guyu.stock.external.ths.ThsParser;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 外部接口连通性探针 —— 按 EXTERNAL_API_ANALYSIS.md 逐个调用文档中的 HTTP 接口。
 *
 * 目的：验证文档记录的接口在 Java(HttpURLConnection, JDK 默认 TLS) 下是否可用。
 * 运行：mvn -pl backend-java test -Dtest=ExternalApiProbeTest
 * 注意：本探针为诊断用途，不参与生产代码；OpenAI/飞书无凭据时跳过。
 */
class ExternalApiProbeTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    private static final String UA_CHROME = UA + " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private static final String SINA_REFERER = "https://finance.sina.com.cn";
    private static final String THS_REFERER = "https://q.10jqka.com.cn/";
    private static final String EM_REFERER = "https://quote.eastmoney.com/";
    private static final String CNINFO_REFERER = "http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice";

    private int pass = 0;
    private int fail = 0;

    // ───────────────────────── HTTP 工具 ─────────────────────────

    private record HttpResult(int status, String contentType, byte[] bytes, Exception error) {
        boolean transportFailed() { return error != null; }
    }

    private HttpResult http(String method, String url, Map<String, String> headers, String postBody) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(20_000);
            conn.setReadTimeout(20_000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept-Encoding", "identity");
            headers.forEach(conn::setRequestProperty);
            if (postBody != null) {
                conn.setDoOutput(true);
                try (var os = conn.getOutputStream()) {
                    os.write(postBody.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            String contentType = conn.getContentType();
            try (InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
                return new HttpResult(status, contentType == null ? "" : contentType,
                        is == null ? new byte[0] : is.readAllBytes(), null);
            }
        } catch (Exception e) {
            return new HttpResult(0, "", new byte[0], e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @FunctionalInterface
    private interface Check {
        /** 返回 "" 表示通过，否则为失败原因 */
        String apply(String body, byte[] raw) throws Exception;
    }

    private void probe(String name, String method, String url, String charset, Check check) {
        probe(name, method, url, Map.of("User-Agent", UA_CHROME), null, charset, check);
    }

    private void probe(String name, String method, String url, Map<String, String> headers,
                       String postBody, String charset, Check check) {
        long t0 = System.currentTimeMillis();
        HttpResult r = http(method, url, headers, postBody);
        long ms = System.currentTimeMillis() - t0;
        String line;
        if (r.transportFailed()) {
            fail++;
            line = "❌ 连接失败 " + r.error().getClass().getSimpleName() + ": " + r.error().getMessage();
        } else if (r.status() >= 400) {
            fail++;
            String body = decode(r.bytes(), charset);
            line = "❌ HTTP " + r.status() + " (" + r.contentType() + ") " + ms + "ms | " + oneLine(body);
        } else {
            String body = decode(r.bytes(), charset);
            try {
                String reason = check.apply(body, r.bytes());
                if (reason == null || reason.isBlank()) {
                    pass++;
                    line = "✅ " + ms + "ms | " + r.bytes().length + "B | " + oneLine(body);
                } else {
                    fail++;
                    line = "❌ 解析异常: " + reason + " | " + ms + "ms | " + r.bytes().length + "B | " + oneLine(body);
                }
            } catch (Exception e) {
                fail++;
                line = "❌ 解析异常: " + e + " | " + ms + "ms | " + r.bytes().length + "B | " + oneLine(body);
            }
        }
        System.out.printf("%-34s %s%n", name, line);
    }

    private static String decode(byte[] raw, String charset) {
        try {
            return new String(raw, Charset.forName(charset));
        } catch (Exception e) {
            return new String(raw, StandardCharsets.UTF_8);
        }
    }

    private static String oneLine(String s) {
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 180 ? t.substring(0, 180) + " …" : t;
    }

    private static String oneLine(byte[] raw, String charset) {
        return oneLine(decode(raw, charset));
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    // ───────────────────────── 探针主体 ─────────────────────────

    @Test
    void probeAllExternalApis() {
        System.out.println("==== 外部接口连通性探针 (Java HttpURLConnection / JDK TLS) ====");

        probeSina();
        probeThs();
        probeEastmoney();
        probeCninfo();
        probeCredentialDependent();

        System.out.printf("%n==== 汇总: 通过 %d / 失败 %d ====%n", pass, fail);
    }

    // ---------- 新浪财经 ----------

    private void probeSina() {
        System.out.println("\n── 新浪财经 ──");

        // 2.1 日K线
        probe("新浪 K线", "GET",
                "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
                        + "?symbol=sh600519&scale=240&ma=no&datalen=5",
                "utf-8", (body, raw) -> {
                    JsonNode arr = MAPPER.readTree(body);
                    if (!arr.isArray() || arr.isEmpty()) return "空数组";
                    if (!arr.get(0).has("day")) return "缺少 day 字段";
                    return "";
                });
        sleep(300);

        // 2.2 股票列表
        probe("新浪 股票列表", "GET",
                "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
                        + "?page=1&num=5&sort=symbol&asc=1&node=sh_a&symbol=&_s_r_a=auto",
                "utf-8", (body, raw) -> {
                    JsonNode arr = MAPPER.readTree(body);
                    if (!arr.isArray() || arr.isEmpty()) return "空数组";
                    if (!arr.get(0).has("code")) return "缺少 code 字段";
                    return "";
                });
        sleep(300);

        // 2.3 行业分类
        probe("新浪 行业分类", "GET",
                "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php",
                "gbk", (body, raw) -> {
                    Matcher m = Pattern.compile("\"new_\\w+\":\"([^\"]+)\"").matcher(body);
                    int n = 0;
                    while (m.find()) n++;
                    return n == 0 ? "未匹配到 new_ 行业条目" : "";
                });
        sleep(300);

        // 2.4 实时行情
        probe("新浪 实时行情", "GET",
                "http://hq.sinajs.cn/list=sh600519,sz000001",
                Map.of("User-Agent", UA_CHROME, "Referer", SINA_REFERER), null,
                "gbk", (body, raw) -> {
                    long n = body.lines().filter(l -> l.contains("hq_str_") && l.contains("\"")).count();
                    return n == 0 ? "未解析到行情行" : "";
                });
        sleep(300);

        // 2.5 个股新闻
        probe("新浪 个股新闻v2", "GET",
                "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=sh600519&Page=1",
                Map.of("User-Agent", UA_CHROME, "Referer", "https://vip.stock.finance.sina.com.cn/"), null,
                "gb2312", (body, raw) -> {
                    Matcher m = Pattern.compile("\\d{4}-\\d{2}-\\d{2}&nbsp;\\d{2}:\\d{2}").matcher(body);
                    int n = 0;
                    while (m.find()) n++;
                    return n == 0 ? "未匹配到新闻条目" : "";
                });
        sleep(300);

        // 2.6 通用feed
        String ts = String.valueOf(System.currentTimeMillis());
        probe("新浪 通用feed", "GET",
                "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=600519&num=3&page=1&r=" + ts + "&callback=jsonp_" + ts,
                Map.of("User-Agent", UA_CHROME, "Referer", SINA_REFERER), null,
                "utf-8", (body, raw) -> {
                    JsonNode root = MAPPER.readTree(Encoders.stripJsonp(raw));
                    JsonNode data = root.path("result").path("data");
                    if (!data.isArray() || data.isEmpty()) return "result.data 为空";
                    return "";
                });
    }

    // ---------- 同花顺 ----------

    private void probeThs() {
        System.out.println("\n── 同花顺 (q.10jqka.com.cn) ──");
        Map<String, String> thsHeaders = Map.of("User-Agent", UA_CHROME, "Referer", THS_REFERER);

        // 4.1 概念板块列表
        probe("同花顺 板块列表", "GET", "https://q.10jqka.com.cn/gn/", thsHeaders, null,
                "utf-8", (body, raw) -> {
                    List<BoardInfo> boards = ThsParser.parseBoardList(raw);
                    return boards.isEmpty() ? "板块列表为空" : "";
                });
        sleep(800);

        // 取第一个 platecode/cid 用于后续探测；失败则用文档示例 BK0999 / 300188
        String plateCode = "BK0999";
        int cid = 300188;
        try {
            var r = http("GET", "https://q.10jqka.com.cn/gn/", thsHeaders, null);
            List<BoardInfo> boards = ThsParser.parseBoardList(r.bytes());
            if (!boards.isEmpty()) {
                plateCode = boards.get(0).plateCode();
                cid = boards.get(0).cid();
                System.out.println("  (使用板块 " + plateCode + " cid=" + cid + " 作为K线/成分股探测样本)");
            }
        } catch (Exception e) {
            System.out.println("  (板块列表不可用，回退到 BK0999/300188 探测)");
        }
        sleep(800);

        // 4.2 概念板块日K线 (JSONP)
        probe("同花顺 板块K线", "GET",
                "https://d.10jqka.com.cn/v4/line/bk_" + plateCode + "/01/last.js", thsHeaders, null,
                "utf-8", (body, raw) -> {
                    List<BoardKLine> kl = ThsParser.parseBoardKLine(raw, 5);
                    return kl.isEmpty() ? "K线为空" : "";
                });
        sleep(800);

        // 4.3 成分股
        probe("同花顺 成分股", "GET",
                "http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/" + cid + "/", thsHeaders, null,
                "utf-8", (body, raw) -> {
                    List<String> codes = ThsParser.parseMembers(raw);
                    return codes.isEmpty() ? "未解析到成分股代码" : "";
                });
    }

    // ---------- 东方财富 ----------

    private void probeEastmoney() {
        System.out.println("\n── 东方财富 ──");
        Map<String, String> emHeaders = Map.of("User-Agent", UA_CHROME, "Referer", EM_REFERER);

        // 5.1 概念板块日K线
        probe("东财 板块K线", "GET",
                "https://push2his.eastmoney.com/api/qt/stock/kline/get"
                        + "?secid=90.BK0999&fields1=f1,f2,f3,f4,f5,f6"
                        + "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=5",
                emHeaders, null, "utf-8", (body, raw) -> {
                    JsonNode klines = MAPPER.readTree(body).path("data").path("klines");
                    if (!klines.isArray() || klines.isEmpty()) return "data.klines 为空";
                    return "";
                });
        sleep(1200);

        // 5.2 板块代码搜索
        probe("东财 板块搜索", "GET",
                "https://searchapi.eastmoney.com/api/suggest/get?input=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD"
                        + "&type=14&token=D43BF722C8E33BDC906FB84D85E329E8&count=5",
                Map.of("User-Agent", UA_CHROME, "Referer", "https://so.eastmoney.com/"), null,
                "utf-8", (body, raw) -> {
                    JsonNode data = MAPPER.readTree(body).path("QuotationCodeTable").path("Data");
                    if (!data.isArray() || data.isEmpty()) return "QuotationCodeTable.Data 为空";
                    return "";
                });
        sleep(1200);

        // 5.3 财经新闻搜索 (JSONP)
        try {
            String paramJson = "{\"uid\":\"\",\"keyword\":\"A股\",\"type\":[\"cmsArticleWebOld\"],"
                    + "\"client\":\"web\",\"clientType\":\"web\",\"clientVersion\":\"curr\","
                    + "\"param\":{\"cmsArticleWebOld\":{\"searchScope\":\"default\",\"sort\":\"default\","
                    + "\"pageIndex\":1,\"pageSize\":3,\"preTag\":\"\",\"postTag\":\"\"}}}";
            String encoded = URLEncoder.encode(paramJson, StandardCharsets.UTF_8);
            probe("东财 新闻搜索", "GET",
                    "https://search-api-web.eastmoney.com/search/jsonp?cb=&param=" + encoded,
                    Map.of("User-Agent", UA_CHROME, "Referer", "https://www.eastmoney.com/"), null,
                    "utf-8", (body, raw) -> {
                        JsonNode items = MAPPER.readTree(body).path("result").path("cmsArticleWebOld");
                        if (!items.isArray() || items.isEmpty()) return "result.cmsArticleWebOld 为空";
                        return "";
                    });
        } catch (Exception e) {
            fail++;
            System.out.printf("%-34s ❌ 构建请求失败: %s%n", "东财 新闻搜索", e);
        }
    }

    // ---------- 巨潮资讯 ----------

    private void probeCninfo() {
        System.out.println("\n── 巨潮资讯 ──");
        Map<String, String> form = new LinkedHashMap<>();
        form.put("pageNum", "1");
        form.put("pageSize", "3");
        form.put("column", "sh");
        form.put("tabName", "fulltext");
        form.put("plate", "sh");
        form.put("stock", "600519,gssh0600519");
        form.put("searchkey", "");
        form.put("secid", "");
        form.put("category", "");
        form.put("trade", "");
        form.put("seDate", "2026-07-01~2026-08-09");
        String bodyStr = form.entrySet().stream()
                .map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .reduce((a, b) -> a + "&" + b).orElse("");

        probe("巨潮 公告查询", "POST", "http://www.cninfo.com.cn/new/hisAnnouncement/query",
                Map.of("User-Agent", UA_CHROME, "Referer", CNINFO_REFERER,
                        "Content-Type", "application/x-www-form-urlencoded"),
                bodyStr, "utf-8", (body, raw) -> {
                    JsonNode arr = MAPPER.readTree(body).path("announcements");
                    if (!arr.isArray() || arr.isEmpty()) return "announcements 为空";
                    return "";
                });
    }

    // ---------- 需要凭据/本地的接口 ----------

    private void probeCredentialDependent() {
        System.out.println("\n── 需要凭据 / 本地的接口 ──");

        String apiKey = System.getenv("OPENAI_API_KEY");
        if (apiKey == null || apiKey.isBlank()) {
            System.out.printf("%-34s ⏭ 跳过（无 OPENAI_API_KEY）%n", "OpenAI Chat");
        } else {
            System.out.printf("%-34s ⏭ 有凭据但探针不发起付费调用（可手动验证）%n", "OpenAI Chat");
        }

        String appId = System.getenv("FEISHU_APP_ID");
        if (appId == null || appId.isBlank()) {
            System.out.printf("%-34s ⏭ 跳过（无 FEISHU_APP_ID/SECRET）%n", "飞书 通知");
        } else {
            System.out.printf("%-34s ⏭ 有凭据但探针不发送真实消息%n", "飞书 通知");
        }

        System.out.printf("%-34s %s%n", "Baostock", "⚠ Python SDK（TCP 协议），Java 无法直接调用");
        System.out.printf("%-34s %s%n", "yfinance", "⚠ Python 库（封装 Yahoo），Java 需改走 HTTP 或换库");

        var local = http("GET", "http://127.0.0.1:8000/api/health", Map.of("User-Agent", UA), null);
        if (local.transportFailed() || local.status() == 0) {
            System.out.printf("%-34s ⏭ 本地 FastAPI 未运行%n", "自身 FastAPI /api/health");
        } else {
            System.out.printf("%-34s ✅ HTTP %d | %s%n", "自身 FastAPI /api/health", local.status(),
                    oneLine(local.bytes(), "utf-8"));
        }
    }
}
