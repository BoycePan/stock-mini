# Go → Java Spring 迁移（C 阶段）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 B 阶段 `backend-java/` 基础上，把 Go 版剩余能力全部迁移：sector 板块接口、news 新闻/公告接口、K 线完整化（分钟线 + 日线回退）、数据采集 + 定时任务。达成 M3 gate（功能全量覆盖，可删 Go 版）。

**Architecture:** 延续 B 阶段分层（`@RestController → @Service → JdbcTemplate repository`），新增 `common/fetcher` 通用 HTTP 组件（重试+退避+限流+GBK+JSONP，对应 Go `pkg/fetcher`），各外部数据源客户端（sina/ths/cninfo）复用；采集用 `@Scheduled` + `ApplicationRunner`，默认 `auto-full:false` 试运行模式。

**Tech Stack:** Java 21、Spring Boot 3.3.x、Spring JDBC、jjwt、Guava RateLimiter、Caffeine、Lombok、H2（测试）。

## Global Constraints

- **API 契约与 Go 版逐字一致**：路径、HTTP 状态码（除 health 外恒 200）、body 字段名。前端 `request.ts` 只认 `{code:200, msg, data}`。
- **数据源编码**：新浪行情/行业/个股新闻 GBK/GB2312 → 转 UTF-8；新浪 K 线 JSON 是 UTF-8；同花顺页面/JSONP 处理 `gnSection` HTML 与 JSONP 去壳；巨潮 POST form + UTF-8 JSON。
- **限流**：sina 1s/次、ths 0.5s/次、cninfo 不限流（单线程串行）。
- **缓存（Caffeine）**：个股新闻 60s、feed 30s、板块K线 60s、公告 5min、分钟线 5→30s / 15→60s / 30→120s / 60→180s、行情 3s（B 阶段已有）。
- **采集验证**：完整移植逻辑，`app.collector.sample-size`（默认 20）小样本跑通；`app.collector.auto-full: false` 默认不自动全量。
- **异步存库**：`@Async` 线程池（对应 Go `go func()`），失败仅记日志不影响响应。
- **错误码/异常**：延续 `ErrCode`/`GlobalExceptionHandler`。
- **包名**：`com.guyu.stock`。生产密钥一律 `${ENV}` 占位。
- **提交规范**：每步一个 commit，`feat:/fix:/test:/docs:` 前缀。

---

## File Structure

**C 阶段新增/改造（backend-java/ 下）：**

| 文件 | 职责 |
|---|---|
| `common/fetcher/DataSource.java` | 通用 HTTP：重试+指数退避+限流+GBK/GB2312 解码+JSONP 去壳 |
| `common/fetcher/Encoders.java` | 编码解码工具（GBK/GB2312→UTF-8、JSONP 去壳） |
| `common/fetcher/FetchException.java` | 抓取异常（对应 Go fmt.Errorf 包装） |
| `external/sina/SinaKlineClient.java` | 日/分钟 K 线（新浪 JSON，字符串字段） |
| `external/sina/SinaInfoClient.java` | 股票列表（分页）+ 行业分类（GBK HTML 正则） |
| `external/sina/SinaNewsClient.java` | 个股新闻（GB2312 HTML 正则）+ feed（JSONP） |
| `external/ths/ThsClient.java` | 板块列表 / 板块K线 / 成分股 |
| `external/ths/ThsParser.java` | 同花顺 HTML/JSONP 解析 |
| `external/cninfo/CninfoClient.java` | 巨潮公告（POST form + JSON） |
| `external/cninfo/Announcement.java` | 公告 POJO |
| `sector/ConceptRepository.java` | concept_board / concept_stock 表 |
| `sector/SectorController.java` | boards / board klines / members |
| `news/NewsRepository.java` | news_feed 表（BatchSave / QueryByStock） |
| `news/NewsController.java` | stock news / feed / announcements |
| `news/AsyncNewsSaver.java` | @Async 异步写库 |
| `collector/CollectorProperties.java` | app.collector.* 配置绑定 |
| `collector/CollectorService.java` | RefreshStockInfo / RefreshConceptData / RunFull(sample) |
| `collector/CollectorScheduler.java` | @Scheduled 9:00/9:05/15:30 + ApplicationRunner 自检 |
| `stock/StockController.java` | 【改造】放开分钟线 + 日线回退新浪 |

**SQL 映射（照抄 Go）：**
- `ConceptRepository.listBoards`: `SELECT plate_code, plate_name, cid FROM concept_board ORDER BY plate_code`
- `ConceptRepository.upsertBoard`: `INSERT INTO concept_board (plate_code, plate_name, cid, updated_at) VALUES (?,?,?,?) ON CONFLICT (plate_code) DO UPDATE SET plate_name=EXCLUDED.plate_name, cid=EXCLUDED.cid, updated_at=EXCLUDED.updated_at`
- `ConceptRepository.replaceMembers`: `DELETE FROM concept_stock WHERE plate_code=?` + 逐条 `INSERT INTO concept_stock (plate_code, stock_code) VALUES (?,?) ON CONFLICT DO NOTHING`
- `ConceptRepository.getMembers`: `SELECT stock_code FROM concept_stock WHERE plate_code=? ORDER BY stock_code`
- `ConceptRepository.countBoards`: `SELECT count(*) FROM concept_board`
- `NewsRepository.batchSave`: `INSERT INTO news_feed (stock_code, title, summary, url, source, published_at) VALUES (?,?,?,?,?,?::timestamptz) ON CONFLICT DO NOTHING`
- `NewsRepository.queryByStock`: `SELECT stock_code, title, summary, url, source, to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at FROM news_feed WHERE stock_code=? ORDER BY published_at DESC LIMIT ?`
- `StockKlineRepository.batchUpsert`: `INSERT INTO stock_kline (code,scale,trade_date,open,high,low,close,volume,amount,turnover,pct_change,change_amt,amplitude,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (code,scale,trade_date) DO UPDATE SET ...`（B 阶段只有 queryByCode/getLatestDate，需补 batchUpsert）

---

### Task 1: 通用 HTTP 组件（fetcher）

**Files:**
- Create: `src/main/java/com/guyu/stock/common/fetcher/Encoders.java`
- Create: `src/main/java/com/guyu/stock/common/fetcher/FetchException.java`
- Create: `src/main/java/com/guyu/stock/common/fetcher/DataSource.java`
- Test: `src/test/java/com/guyu/stock/common/fetcher/EncodersTest.java`
- Test: `src/test/java/com/guyu/stock/common/fetcher/DataSourceTest.java`

**Interfaces:**
- Produces:
  - `String Encoders.gbkToUtf8(byte[] raw)`（ISO-8859-1 桥接 + GBK 解码）
  - `String Encoders.decode(byte[] raw, String charset)`（如 "gbk"/"gb2312"）
  - `byte[] Encoders.stripJsonp(byte[] raw)`（JSONP 去壳，括号计数）
  - `class FetchException extends RuntimeException`（含 `int sourceCode` 可选）
  - `class DataSource`：构造 `DataSource(String name, double rateLimitSeconds, int maxRetries, String userAgent, String referer)`；`byte[] getBytes(String url)`（重试+退避+限流）；`String getString(String url)`（getBytes + 按 UTF-8）；`String getStringDecoded(String url, String charset)`（getBytes + decode）；`String postForm(String url, Map<String,String> form)`（表单 POST）
  - 静态工厂：`DataSource.sina()/ths()/cninfo()`（预设限流/UA/Referer）

- [ ] **Step 1: 写失败测试**

`EncodersTest.java`:

```java
package com.guyu.stock.common.fetcher;

import org.junit.jupiter.api.Test;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.assertThat;

class EncodersTest {

    @Test
    void gbkToUtf8DecodesChinese() {
        byte[] gbk = "贵州茅台".getBytes(Charset.forName("GBK"));
        assertThat(Encoders.gbkToUtf8(gbk)).isEqualTo("贵州茅台");
    }

    @Test
    void stripJsonpExtractsObject() {
        byte[] jsonp = "callback({\"a\":1,\"b\":{\"c\":2}})".getBytes(StandardCharsets.UTF_8);
        assertThat(Encoders.stripJsonp(jsonp)).isEqualTo("{\"a\":1,\"b\":{\"c\":2}}".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void stripJsonpPassesThroughPlainJson() {
        byte[] json = "{\"a\":1}".getBytes(StandardCharsets.UTF_8);
        assertThat(Encoders.stripJsonp(json)).isEqualTo(json);
    }
}
```

`DataSourceTest.java`（用 stub HttpURLConnection 验证限流/重试计数 —— 简化：直接测工厂参数与抛错路径）：

```java
package com.guyu.stock.common.fetcher;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DataSourceTest {

    @Test
    void factoriesPresetConfig() {
        assertThat(DataSource.sina().maxRetries()).isEqualTo(3);
        assertThat(DataSource.ths().maxRetries()).isEqualTo(3);
        assertThat(DataSource.cninfo().maxRetries()).isEqualTo(1);
    }

    @Test
    void getStringOnUnreachableHostThrows() {
        DataSource ds = DataSource.sina();
        assertThatThrownBy(() -> ds.getString("http://127.0.0.1:1/nonexistent"))
                .isInstanceOf(FetchException.class);
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `cd backend-java && mvn -s /Users/lilaiyun/Code/GuYuInfo/code/wx-app-stock/.superpowers/sdd/central-maven-settings.xml -nsu test -Dtest=EncodersTest,DataSourceTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`Encoders.java`:

```java
package com.guyu.stock.common.fetcher;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

public final class Encoders {

    private Encoders() {}

    /** 与 Go DecodeBytes(raw,"gbk") 等效：ISO-8859-1 桥接保留字节，再按 GBK 解码 */
    public static String gbkToUtf8(byte[] raw) {
        return new String(raw, Charset.forName("GBK"));
    }

    public static String decode(byte[] raw, String charset) {
        return new String(raw, Charset.forName(charset));
    }

    /** 与 Go StripJSONP 等效：已是 JSON 则原样返回；否则从第一个 { 括号计数提取 */
    public static byte[] stripJsonp(byte[] raw) {
        String s = new String(raw, StandardCharsets.UTF_8).trim();
        if (s.startsWith("{") || s.startsWith("[")) {
            return s.getBytes(StandardCharsets.UTF_8);
        }
        s = s.replaceFirst("^try\\{", "");
        int start = s.indexOf('{');
        if (start < 0) {
            throw new FetchException("无法解析 JSONP 格式: " + s.substring(0, Math.min(s.length(), 80)));
        }
        int depth = 0;
        for (int i = start; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '{') depth++;
            else if (ch == '}') {
                depth--;
                if (depth == 0) {
                    return s.substring(start, i + 1).getBytes(StandardCharsets.UTF_8);
                }
            }
        }
        throw new FetchException("JSONP 括号不匹配");
    }
}
```

`FetchException.java`:

```java
package com.guyu.stock.common.fetcher;

public class FetchException extends RuntimeException {
    public FetchException(String message) { super(message); }
    public FetchException(String message, Throwable cause) { super(message, cause); }
}
```

`DataSource.java`（`getStringDecoded` 处理 GBK；`postForm` 用于巨潮）：

```java
package com.guyu.stock.common.fetcher;

import com.google.common.util.concurrent.RateLimiter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.StringJoiner;

public class DataSource {

    private final String name;
    private final double rateLimitSeconds;
    private final int maxRetries;
    private final String userAgent;
    private final String referer;
    private final RateLimiter limiter;

    public DataSource(String name, double rateLimitSeconds, int maxRetries, String userAgent, String referer) {
        this.name = name;
        this.rateLimitSeconds = rateLimitSeconds;
        this.maxRetries = Math.max(0, maxRetries);
        this.userAgent = userAgent;
        this.referer = referer;
        this.limiter = rateLimitSeconds > 0 ? RateLimiter.create(1.0 / rateLimitSeconds) : null;
    }

    public static DataSource sina() {
        return new DataSource("sina", 1.0, 3,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "https://finance.sina.com.cn");
    }

    public static DataSource ths() {
        return new DataSource("ths", 0.5, 3,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "https://q.10jqka.com.cn/");
    }

    public static DataSource cninfo() {
        return new DataSource("cninfo", 0, 1,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "http://www.cninfo.com.cn/");
    }

    public String name() { return name; }
    public int maxRetries() { return maxRetries; }

    public byte[] getBytes(String url) {
        RuntimeException last = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                sleep(500L * (1L << (attempt - 1))); // 指数退避 500ms→1s→2s
            }
            if (limiter != null) limiter.acquire();
            try {
                return doGet(url);
            } catch (RuntimeException e) {
                last = e;
            }
        }
        throw new FetchException("fetcher[" + name + "] 重试" + maxRetries + "次后仍然失败", last);
    }

    public String getString(String url) {
        return new String(getBytes(url), StandardCharsets.UTF_8);
    }

    public String getStringDecoded(String url, String charset) {
        return Encoders.decode(getBytes(url), charset);
    }

    public String postForm(String url, Map<String, String> form) {
        if (limiter != null) limiter.acquire();
        try {
            StringJoiner sj = new StringJoiner("&");
            for (Map.Entry<String, String> e : form.entrySet()) {
                sj.add(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue() == null ? "" : e.getValue(), StandardCharsets.UTF_8));
            }
            byte[] body = sj.toString().getBytes(StandardCharsets.UTF_8);
            HttpURLConnection conn = open(url);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) { os.write(body); }
            return new String(readAll(conn), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new FetchException("POST 失败: " + url, e);
        }
    }

    private byte[] doGet(String url) {
        try {
            HttpURLConnection conn = open(url);
            return readAll(conn);
        } catch (IOException e) {
            throw new FetchException("请求失败: " + url, e);
        }
    }

    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(30_000);
        conn.setReadTimeout(30_000);
        conn.setInstanceFollowRedirects(true);
        if (userAgent != null && !userAgent.isBlank()) conn.setRequestProperty("User-Agent", userAgent);
        if (referer != null && !referer.isBlank()) conn.setRequestProperty("Referer", referer);
        return conn;
    }

    private byte[] readAll(HttpURLConnection conn) throws IOException {
        try (InputStream is = conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
            if (is == null) return new byte[0];
            return is.readAllBytes();
        } finally {
            conn.disconnect();
        }
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend-java && mvn -s .../central-maven-settings.xml -nsu test -Dtest=EncodersTest,DataSourceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/common/fetcher src/test/java/com/guyu/stock/common/fetcher
git commit -m "feat: add generic HTTP fetcher with retry, backoff, rate limit, encoding"
```

---

### Task 2: Sina K 线客户端

**Files:**
- Create: `src/main/java/com/guyu/stock/external/sina/SinaKlineClient.java`
- Test: `src/test/java/com/guyu/stock/external/sina/SinaKlineClientTest.java`

**Interfaces:**
- Consumes: `DataSource`（Task 1）
- Produces:
  - `record KLine(String time, double open, double high, double low, double close, long volume)`
  - `record KLineResult(String code, String scale, List<KLine> klines, int count)`
  - `KLineResult SinaKlineClient.getKLine(String code, String scale, int count)`（minute cache TTL 5→30s/15→60s/30→120s/60→180s；scale=240 不缓存）
  - `String SinaKlineClient.toSymbol(String code)`（6/9→sh，其他→sz）

**Go 参考**：`backend/pkg/sina/kline.go`（URL `CN_MarketData.getKLineData?symbol=&scale=&ma=no&datalen=`；JSON 数组，字段 day/open/high/low/close/volume 为字符串）

- [ ] **Step 1: 写失败测试**

`SinaKlineClientTest.java`（不连网，测解析 + toSymbol + 缓存命中计数）：

```java
package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class SinaKlineClientTest {

    static class StubSource extends DataSource {
        final AtomicInteger calls = new AtomicInteger();
        String body = "[{\"day\":\"2026-08-05\",\"open\":\"1700\",\"high\":\"1720\",\"low\":\"1690\",\"close\":\"1710\",\"volume\":\"10000\"}," +
                "{\"day\":\"2026-08-06\",\"open\":\"1710\",\"high\":\"1730\",\"low\":\"1700\",\"close\":\"1725\",\"volume\":\"12000\"}]";
        StubSource() { super("stub", 0, 0, null, null); }
        @Override public byte[] getBytes(String url) { calls.incrementAndGet(); return body.getBytes(java.nio.charset.StandardCharsets.UTF_8); }
    }

    @Test
    void parsesKlineJsonWithStringFields() throws Exception {
        StubSource source = new StubSource();
        SinaKlineClient client = new SinaKlineClient(source, 0);
        // 通过反射注入 DataSource 以复用真实解析路径
        Field f = SinaKlineClient.class.getDeclaredField("source");
        f.setAccessible(true); f.set(client, source);

        KLineResult r = client.getKLine("600001", "240", 100);
        assertThat(r.code()).isEqualTo("600001");
        assertThat(r.scale()).isEqualTo("240");
        assertThat(r.klines()).hasSize(2);
        assertThat(r.klines().get(0).time()).isEqualTo("2026-08-05");
        assertThat(r.klines().get(0).open()).isEqualTo(1700.0);
        assertThat(r.klines().get(0).volume()).isEqualTo(10000);
    }

    @Test
    void toSymbolMapsMarkets() {
        SinaKlineClient client = new SinaKlineClient(DataSource.sina(), 0);
        assertThat(client.toSymbol("600001")).isEqualTo("sh600001");
        assertThat(client.toSymbol("000001")).isEqualTo("sz000001");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaKlineClientTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`SinaKlineClient.java`:

```java
package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

public class SinaKlineClient {

    public record KLine(String time, double open, double high, double low, double close, long volume) {}
    public record KLineResult(String code, String scale, List<KLine> klines, int count) {}

    private static final String KLINE_URL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;
    private final Cache<String, KLineResult> minuteCache;

    public SinaKlineClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        this.minuteCache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
    }

    public String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }

    public KLineResult getKLine(String code, String scale, int count) {
        if (count <= 0) count = 100;
        if (!"240".equals(scale)) {
            String key = code + ":" + scale;
            KLineResult cached = minuteCache.getIfPresent(key);
            if (cached != null) return cached;
            KLineResult r = fetch(code, scale, count);
            minuteCache.put(key, r, ttl(scale));
            return r;
        }
        return fetch(code, scale, count);
    }

    private KLineResult fetch(String code, String scale, int count) {
        String url = KLINE_URL + "?symbol=" + toSymbol(code) + "&scale=" + scale + "&ma=no&datalen=" + count;
        String body = source.getString(url);
        try {
            JsonNode arr = MAPPER.readTree(body);
            List<KLine> klines = new ArrayList<>();
            for (JsonNode n : arr) {
                klines.add(new KLine(
                        n.get("day").asText(),
                        n.get("open").asDouble(),
                        n.get("high").asDouble(),
                        n.get("low").asDouble(),
                        n.get("close").asDouble(),
                        n.get("volume").asLong()));
            }
            return new KLineResult(code, scale, klines, klines.size());
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("新浪K线 JSON 解析失败", e);
        }
    }

    private static Duration ttl(String scale) {
        return switch (scale) {
            case "5" -> Duration.ofSeconds(30);
            case "15" -> Duration.ofSeconds(60);
            case "30" -> Duration.ofSeconds(120);
            case "60" -> Duration.ofSeconds(180);
            default -> Duration.ofSeconds(60);
        };
    }
}
```

**注意**：测试通过反射注入 `source`。为使实现更干净，构造器第二个参数为缓存大小；`getBytes` 被 StubSource 重写（DataSource.getBytes 是 public，可重写）。测试里 `super("stub", 0, 0, null, null)` 调 DataSource 构造器。

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaKlineClientTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/sina/SinaKlineClient.java src/test/java/com/guyu/stock/external/sina/SinaKlineClientTest.java
git commit -m "feat: add Sina K-line client with minute-level cache"
```

---

### Task 3: Sina 信息客户端（股票列表 + 行业分类）

**Files:**
- Create: `src/main/java/com/guyu/stock/external/sina/SinaInfoClient.java`
- Test: `src/test/java/com/guyu/stock/external/sina/SinaInfoClientTest.java`

**Interfaces:**
- Consumes: `DataSource`（Task 1）
- Produces:
  - `record SinaStock(String code, String name, String market, String board)`（board: main/chinext/star）
  - `List<SinaStock> SinaInfoClient.fetchStockList()`（沪/深分页，每页 80，间隔 150ms）
  - `Map<String,String> SinaInfoClient.fetchIndustryMap()`（GBK HTML 正则，code→industry）

**Go 参考**：`backend/pkg/sina/info.go`（`Market_Center.getHQNodeData?page=&num=80&node=sh_a|sz_a`；行业 `newSinaHy.php` 正则 `"new_\w+":"..."`，parts[1]=行业名、parts[8:]=4字段组）

- [ ] **Step 1: 写失败测试**

`SinaInfoClientTest.java`:

```java
package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SinaInfoClientTest {

    /** 分页 stub：第一页返回 1 条（<80 触发结束），第二页空 */
    static class StockListStub extends DataSource {
        int call;
        StockListStub() { super("stub", 0, 0, null, null); }
        @Override public byte[] getBytes(String url) {
            call++;
            if (call == 1) return "[{\"code\":\"600519\",\"name\":\"贵州茅台\"}]".getBytes(StandardCharsets.UTF_8);
            return "[]".getBytes(StandardCharsets.UTF_8);
        }
    }

    @Test
    void fetchStockListPadsCodeAndInfersMarket() {
        SinaInfoClient client = new SinaInfoClient(new StockListStub());
        List<SinaStock> stocks = client.fetchStockList();
        assertThat(stocks).hasSize(1);
        assertThat(stocks.get(0).code()).isEqualTo("600519");
        assertThat(stocks.get(0).market()).isEqualTo("sh");
        assertThat(stocks.get(0).board()).isEqualTo("main");
    }

    @Test
    void fetchIndustryMapParsesGbkHtml() {
        // 构造 "new_hy1":"X,银行,X,X,X,X,X,X,sh600001,贵州茅台,1,2" 的 GBK 字节
        String line = "new_hy1\":\"X,银行,X,X,X,X,X,X,sh600001,贵州茅台,1700,1\"";
        byte[] gbk = ("var data={" + line + "}").getBytes(Charset.forName("GBK"));
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return gbk; }
        };
        SinaInfoClient client = new SinaInfoClient(stub);
        Map<String, String> map = client.fetchIndustryMap();
        assertThat(map.get("600001")).isEqualTo("银行");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaInfoClientTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`SinaInfoClient.java`:

```java
package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.DataSource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SinaInfoClient {

    public record SinaStock(String code, String name, String market, String board) {}

    private static final String LIST_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
    private static final String INDUSTRY_URL = "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php";
    private static final Pattern INDUSTRY_PATTERN = Pattern.compile("\"new_\\w+\":\"([^\"]+)\"");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;

    public SinaInfoClient(DataSource source) {
        this.source = source;
    }

    public List<SinaStock> fetchStockList() {
        List<SinaStock> all = new ArrayList<>();
        for (String node : List.of("sh_a", "sz_a")) {
            for (int page = 1; page < 100; page++) {
                String url = LIST_URL + "?page=" + page + "&num=80&sort=symbol&asc=1&node=" + node + "&symbol=&_s_r_a=auto";
                String body = source.getString(url);
                try {
                    JsonNode arr = MAPPER.readTree(body);
                    for (JsonNode n : arr) {
                        String code = String.format("%06d", n.get("code").asInt());
                        all.add(new SinaStock(code, n.get("name").asText(), marketFromCode(code), boardFromCode(code)));
                    }
                    if (arr.size() < 80) break;
                } catch (Exception e) {
                    throw new com.guyu.stock.common.fetcher.FetchException("解析股票列表 JSON 失败", e);
                }
                sleep(150);
            }
        }
        return all;
    }

    public Map<String, String> fetchIndustryMap() {
        String html = source.getStringDecoded(INDUSTRY_URL, "gbk");
        Map<String, String> result = new LinkedHashMap<>();
        Matcher m = INDUSTRY_PATTERN.matcher(html);
        while (m.find()) {
            String[] parts = m.group(1).split(",");
            if (parts.length < 9) continue;
            String industry = parts[1];
            for (int i = 8; i + 3 < parts.length; i += 4) {
                String code = stripMarketPrefix(parts[i]);
                code = String.format("%06d", safeInt(code));
                if (!code.equals("000000")) result.put(code, industry);
            }
        }
        return result;
    }

    static String marketFromCode(String code) {
        if (code == null || code.isEmpty()) return "";
        return switch (code.charAt(0)) {
            case '6', '9' -> "sh";
            case '0', '3' -> "sz";
            case '4', '8' -> "bj";
            default -> "";
        };
    }

    static String boardFromCode(String code) {
        if (code.length() < 3) return "main";
        if (code.startsWith("300") || code.startsWith("301")) return "chinext";
        if (code.startsWith("688")) return "star";
        return "main";
    }

    private static String stripMarketPrefix(String s) {
        if (s.length() > 2 && (s.startsWith("sh") || s.startsWith("sz") || s.startsWith("bj"))) return s.substring(2);
        return s;
    }

    private static int safeInt(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
```

**注意**：Go 的 `fmt.Sprintf("%06s", code)` 对数字/字符串补零；Java 用 `String.format("%06d", asInt)`，因此 `safeInt` 处理非数字返回 0，再过滤 "000000"（Go 无此过滤，但实际代码不含非法值；此过滤仅防脏数据）。

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaInfoClientTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/sina/SinaInfoClient.java src/test/java/com/guyu/stock/external/sina/SinaInfoClientTest.java
git commit -m "feat: add Sina info client (stock list + industry map)"
```

---

### Task 4: Sina 新闻客户端（个股新闻 + feed）

**Files:**
- Create: `src/main/java/com/guyu/stock/external/sina/SinaNewsClient.java`
- Test: `src/test/java/com/guyu/stock/external/sina/SinaNewsClientTest.java`

**Interfaces:**
- Consumes: `DataSource` + `Encoders`（Task 1）
- Produces:
  - `record NewsItem(String title, String summary, String url, String time, String source)`
  - `List<NewsItem> SinaNewsClient.fetchStockNews(String code, int page)`（GB2312 HTML 正则，Caffeine 60s）
  - `List<NewsItem> SinaNewsClient.fetchFeedNews(String keyword, int count)`（JSONP，Caffeine 30s）

**Go 参考**：`backend/pkg/sina/news.go`（个股新闻 URL `vCB_AllNewsStock.php?symbol=&Page=`，正则 `(\d{4}-\d{2}-\d{2})&nbsp;(\d{2}:\d{2})&nbsp;&nbsp;<a[^>]*href=['"]([^'"]+)['"][^>]*>([^<]+)</a>`；feed URL `feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num=&page=1&r=时间戳&callback=jsonp`，JSONP 去壳后 `result.data[]` 含 title/intro/ctime/unix/media_name）

- [ ] **Step 1: 写失败测试**

`SinaNewsClientTest.java`:

```java
package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SinaNewsClientTest {

    @Test
    void parsesStockNewsHtml() {
        String html = "<table>2026-08-05&nbsp;10:30&nbsp;&nbsp;<a href=\"http://x/1\">茅台发布财报</a></table>";
        byte[] gbk = html.getBytes(Charset.forName("GBK"));
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return gbk; }
        };
        SinaNewsClient client = new SinaNewsClient(stub, 0);
        List<NewsItem> items = client.fetchStockNews("600519", 1);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("茅台发布财报");
        assertThat(items.get(0).time()).isEqualTo("2026-08-05 10:30");
        assertThat(items.get(0).source()).isEqualTo("新浪");
    }

    @Test
    void parsesFeedJsonp() {
        String body = "jsonp({\"result\":{\"data\":[{\"title\":\"标题A\",\"intro\":\"摘要\",\"url\":\"http://u/1\"," +
                "\"ctime\":1723000000,\"media_name\":\"财联社\"}]}})";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        SinaNewsClient client = new SinaNewsClient(stub, 0);
        List<NewsItem> items = client.fetchFeedNews("A股", 20);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("标题A");
        assertThat(items.get(0).source()).isEqualTo("财联社");
        assertThat(items.get(0).time()).matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaNewsClientTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`SinaNewsClient.java`:

```java
package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.common.fetcher.Encoders;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SinaNewsClient {

    public record NewsItem(String title, String summary, String url, String time, String source) {}

    private static final String STOCK_NEWS_URL = "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=%s&Page=%d";
    private static final String FEED_URL = "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=%s&num=%d&page=1&r=%d&callback=jsonp";
    private static final Pattern STOCK_NEWS_PATTERN = Pattern.compile(
            "(\\d{4}-\\d{2}-\\d{2})&nbsp;(\\d{2}:\\d{2})&nbsp;&nbsp;<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>([^<]+)</a>");
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            .withZone(ZoneId.of("Asia/Shanghai"));
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;
    private final Cache<String, List<NewsItem>> stockNewsCache;
    private final Cache<String, List<NewsItem>> feedCache;

    public SinaNewsClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        this.stockNewsCache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
        this.feedCache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
    }

    public List<NewsItem> fetchStockNews(String code, int page) {
        if (page <= 0) page = 1;
        String key = "stock:" + code + ":" + page;
        List<NewsItem> cached = stockNewsCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(STOCK_NEWS_URL, toSymbol(code), page);
        byte[] raw = source.getBytes(url);
        String html = Encoders.decode(raw, "gb2312");
        List<NewsItem> items = parseStockNews(html);
        stockNewsCache.put(key, items, Duration.ofSeconds(60));
        return items;
    }

    public List<NewsItem> fetchFeedNews(String keyword, int count) {
        if (count <= 0) count = 20;
        String key = "feed:" + keyword + ":" + count;
        List<NewsItem> cached = feedCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(FEED_URL, keyword, count, Instant.now().toEpochMilli());
        byte[] raw = source.getBytes(url);
        byte[] json = Encoders.stripJsonp(raw);
        List<NewsItem> items = parseFeed(json);
        feedCache.put(key, items, Duration.ofSeconds(30));
        return items;
    }

    private List<NewsItem> parseStockNews(String html) {
        List<NewsItem> items = new ArrayList<>();
        Matcher m = STOCK_NEWS_PATTERN.matcher(html);
        while (m.find()) {
            items.add(new NewsItem(m.group(4).trim(), "", m.group(3), m.group(1) + " " + m.group(2), "新浪"));
        }
        return items;
    }

    private List<NewsItem> parseFeed(byte[] json) {
        List<NewsItem> items = new ArrayList<>();
        try {
            JsonNode root = MAPPER.readTree(json);
            JsonNode data = root.path("result").path("data");
            for (JsonNode n : data) {
                String source = n.path("media_name").asText("");
                if (source.isEmpty()) source = "新浪财经";
                items.add(new NewsItem(
                        n.path("title").asText(""),
                        n.path("intro").asText(""),
                        n.path("url").asText(""),
                        fmtTime(n.path("ctime").asLong(0)),
                        source));
            }
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("新闻feed JSON解析失败", e);
        }
        return items;
    }

    private static String fmtTime(long epochSecond) {
        return epochSecond <= 0 ? "" : TIME_FMT.format(Instant.ofEpochSecond(epochSecond));
    }

    static String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=SinaNewsClientTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/sina/SinaNewsClient.java src/test/java/com/guyu/stock/external/sina/SinaNewsClientTest.java
git commit -m "feat: add Sina news client (stock news + feed)"
```

---

### Task 5: 同花顺客户端（板块列表 / 板块K线 / 成分股）

**Files:**
- Create: `src/main/java/com/guyu/stock/external/ths/BoardInfo.java`
- Create: `src/main/java/com/guyu/stock/external/ths/BoardKLine.java`
- Create: `src/main/java/com/guyu/stock/external/ths/ThsParser.java`
- Create: `src/main/java/com/guyu/stock/external/ths/ThsClient.java`
- Test: `src/test/java/com/guyu/stock/external/ths/ThsClientTest.java`

**Interfaces:**
- Consumes: `DataSource` + `Encoders`（Task 1）
- Produces:
  - `record BoardInfo(int cid, String plateCode, String plateName, double pctChg)`
  - `record BoardKLine(String date, double open, double high, double low, double close, long volume, double amount)`
  - `List<BoardInfo> ThsClient.fetchBoardList(int topN)`（Caffeine 60s；`id="gnSection"` 隐藏 JSON，key=序号，含 platecode/platename/cid(字符串)/199112）
  - `List<BoardKLine> ThsClient.fetchBoardKLine(String plateCode, int count)`（Caffeine 60s；JSONP `d.10jqka.com.cn/v4/line/bk_{code}/01/last.js`，data 字段分号分隔，每行 7 字段 date,open,high,low,close,volume,amount）
  - `List<String> ThsClient.fetchMembers(int cid)`（HTML `<td><a>XXXXXX</a></td>` 正则，只留 0/3/6 开头 A 股）

**Go 参考**：`backend/pkg/ths/board.go`（`gnSectionPattern`、`parseBoardKLine`、`stockCodePattern`）

- [ ] **Step 1: 写失败测试**

`ThsClientTest.java`:

```java
package com.guyu.stock.external.ths;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ThsClientTest {

    @Test
    void parsesBoardListGnSection() {
        String html = "<input id=\"gnSection\" value='{\"0\":{\"platecode\":\"885333\",\"platename\":\"人工智能\",\"cid\":\"300188\",\"199112\":\"1.5\"}}' />";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return html.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<BoardInfo> boards = client.fetchBoardList(60);
        assertThat(boards).hasSize(1);
        assertThat(boards.get(0).plateCode()).isEqualTo("885333");
        assertThat(boards.get(0).cid()).isEqualTo(300188);
    }

    @Test
    void parsesBoardKLineJsonp() {
        String body = "quotebridge_v4_line_bk_885552_01_last({\"data\":\"20140513,100,110,90,105,1000,200000;20140514,105,115,100,112,1200,250000\"})";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<BoardKLine> klines = client.fetchBoardKLine("885552", 30);
        assertThat(klines).hasSize(2);
        assertThat(klines.get(0).date()).isEqualTo("2014-05-13");
        assertThat(klines.get(0).close()).isEqualTo(105.0);
        assertThat(klines.get(1).volume()).isEqualTo(1200);
    }

    @Test
    void parsesMembersOnlyAStocks() {
        String html = "<td><a href=\"/x/\">600519</a></td><td><a>999999</a></td><td><a>000001</a></td>";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return html.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<String> codes = client.fetchMembers(885552);
        assertThat(codes).containsExactly("600519", "000001");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=ThsClientTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`BoardInfo.java` / `BoardKLine.java`（record，字段对齐 Go json tag）：

```java
package com.guyu.stock.external.ths;

public record BoardInfo(int cid, String plateCode, String plateName, double pctChg) {}
```

```java
package com.guyu.stock.external.ths;

public record BoardKLine(String date, double open, double high, double low, double close, long volume, double amount) {}
```

`ThsParser.java`:

```java
package com.guyu.stock.external.ths;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.Encoders;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ThsParser {

    private static final Pattern GN_SECTION = Pattern.compile("id=\"gnSection\"[^>]*value='([^']*)'");
    private static final Pattern STOCK_CODE = Pattern.compile("<td[^>]*>\\s*<a[^>]*>\\s*(\\d{6})\\s*</a>\\s*</td>");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ThsParser() {}

    public static List<BoardInfo> parseBoardList(byte[] htmlBytes) {
        String html = new String(htmlBytes, java.nio.charset.StandardCharsets.UTF_8);
        Matcher m = GN_SECTION.matcher(html);
        if (!m.find()) throw new com.guyu.stock.common.fetcher.FetchException("未找到 gnSection 字段");
        try {
            JsonNode root = MAPPER.readTree(m.group(1));
            List<BoardInfo> boards = new ArrayList<>();
            root.fields().forEachRemaining(entry -> {
                JsonNode v = entry.getValue();
                int cid = Integer.parseInt(v.path("cid").asText("0"));
                boards.add(new BoardInfo(cid,
                        v.path("platecode").asText(""),
                        v.path("platename").asText(""),
                        v.path("199112").asDouble(0)));
            });
            return boards;
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("板块列表JSON解析失败", e);
        }
    }

    public static List<BoardKLine> parseBoardKLine(byte[] jsonpBytes, int count) {
        byte[] json = Encoders.stripJsonp(jsonpBytes);
        try {
            String data = MAPPER.readTree(json).path("data").asText("");
            if (data.isEmpty()) return new ArrayList<>();
            String[] lines = data.split(";");
            int start = Math.max(0, lines.length - count);
            List<BoardKLine> klines = new ArrayList<>();
            for (int i = start; i < lines.length; i++) {
                String line = lines[i].trim();
                if (line.isEmpty()) continue;
                String[] p = line.split(",");
                if (p.length < 7) continue;
                String date = p[0].length() == 8 ? p[0].substring(0,4) + "-" + p[0].substring(4,6) + "-" + p[0].substring(6,8) : p[0];
                klines.add(new BoardKLine(date, parseDouble(p[1]), parseDouble(p[2]), parseDouble(p[3]),
                        parseDouble(p[4]), parseLong(p[5]), parseDouble(p[6])));
            }
            return klines;
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("板块K线JSON解析失败", e);
        }
    }

    public static List<String> parseMembers(byte[] htmlBytes) {
        String html = new String(htmlBytes, java.nio.charset.StandardCharsets.UTF_8);
        List<String> codes = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        Matcher m = STOCK_CODE.matcher(html);
        while (m.find()) {
            String code = m.group(1);
            char first = code.charAt(0);
            if ((first == '0' || first == '3' || first == '6') && seen.add(code)) codes.add(code);
        }
        return codes;
    }

    private static double parseDouble(String s) {
        try { return Double.parseDouble(s.trim()); } catch (NumberFormatException e) { return 0; }
    }
    private static long parseLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0; }
    }
}
```

`ThsClient.java`:

```java
package com.guyu.stock.external.ths;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;

import java.time.Duration;
import java.util.List;

public class ThsClient {

    private static final String BOARD_LIST_URL = "https://q.10jqka.com.cn/gn/";
    private static final String KLINE_URL = "https://d.10jqka.com.cn/v4/line/bk_%s/01/last.js";
    private static final String MEMBERS_URL = "http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/%d/";

    private final DataSource source;
    private final Cache<String, List<BoardInfo>> boardListCache;
    private final Cache<String, List<BoardKLine>> boardKlineCache;

    public ThsClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        this.boardListCache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
        this.boardKlineCache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
    }

    public List<BoardInfo> fetchBoardList(int topN) {
        if (topN <= 0) topN = 60;
        List<BoardInfo> cached = boardListCache.getIfPresent("all");
        if (cached != null) return top(cached, topN);
        List<BoardInfo> boards = ThsParser.parseBoardList(source.getBytes(BOARD_LIST_URL));
        boards.sort((a, b) -> Double.compare(b.pctChg(), a.pctChg()));
        boardListCache.put("all", boards, Duration.ofSeconds(60));
        return top(boards, topN);
    }

    public List<BoardKLine> fetchBoardKLine(String plateCode, int count) {
        if (count <= 0) count = 30;
        String key = plateCode + ":" + count;
        List<BoardKLine> cached = boardKlineCache.getIfPresent(key);
        if (cached != null) return cached;
        String url = String.format(KLINE_URL, plateCode);
        List<BoardKLine> klines = ThsParser.parseBoardKLine(source.getBytes(url), count);
        boardKlineCache.put(key, klines, Duration.ofSeconds(60));
        return klines;
    }

    public List<String> fetchMembers(int cid) {
        String url = String.format(MEMBERS_URL, cid);
        return ThsParser.parseMembers(source.getBytes(url));
    }

    private static <T> List<T> top(List<T> list, int n) {
        return n >= list.size() ? list : new java.util.ArrayList<>(list.subList(0, n));
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=ThsClientTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/ths src/test/java/com/guyu/stock/external/ths
git commit -m "feat: add THS client for concept boards"
```

---

### Task 6: 巨潮公告客户端

**Files:**
- Create: `src/main/java/com/guyu/stock/external/cninfo/Announcement.java`
- Create: `src/main/java/com/guyu/stock/external/cninfo/CninfoClient.java`
- Test: `src/test/java/com/guyu/stock/external/cninfo/CninfoClientTest.java`

**Interfaces:**
- Consumes: `DataSource`（Task 1）
- Produces:
  - `record Announcement(String id, String title, String time, String url, String pdf)`（JSON 字段：id/title/time/url/pdf）
  - `List<Announcement> CninfoClient.fetchAnnouncements(String code, int page, int pageSize)`（Caffeine 5min；POST `www.cninfo.com.cn/new/hisAnnouncement/query`，form 含 pageNum/pageSize/column/stock=`code,orgId`）

**Go 参考**：`backend/pkg/cninfo/cninfo.go`（marketInfo：6→sh,gssh0{code}；其他→sz,gssz0{code}；响应 `announcements[]` 含 announcementId/announcementTitle/announcementTime(ms)/adjunctUrl）

- [ ] **Step 1: 写失败测试**

`CninfoClientTest.java`:

```java
package com.guyu.stock.external.cninfo;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CninfoClientTest {

    @Test
    void parsesAnnouncementsAndBuildsUrls() {
        String body = "{\"announcements\":[{\"announcementId\":\"a1\",\"announcementTitle\":\"年报\"," +
                "\"announcementTime\":1723000000000,\"adjunctUrl\":\"/pdf/1.pdf\"}]}";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public String postForm(String url, java.util.Map<String, String> form) {
                assertThat(form.get("stock")).isEqualTo("600519,gssh0600519");
                return body;
            }
        };
        CninfoClient client = new CninfoClient(stub);
        List<Announcement> items = client.fetchAnnouncements("600519", 1, 20);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("年报");
        assertThat(items.get(0).time()).matches("\\d{4}-\\d{2}-\\d{2}");
        assertThat(items.get(0).pdf()).isEqualTo("https://static.cninfo.com.cn/pdf/1.pdf");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CninfoClientTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`Announcement.java`:

```java
package com.guyu.stock.external.cninfo;

import com.fasterxml.jackson.annotation.JsonProperty;

public record Announcement(
        String id,
        String title,
        String time,
        String url,
        String pdf) {}
```

`CninfoClient.java`:

```java
package com.guyu.stock.external.cninfo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.fetcher.DataSource;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class CninfoClient {

    private static final String QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")
            .withZone(ZoneId.of("Asia/Shanghai"));
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;
    private final Cache<String, List<Announcement>> cache;

    public CninfoClient(DataSource source, long cacheMaxSize) {
        this.source = source;
        this.cache = Caffeine.newBuilder().maximumSize(cacheMaxSize).build();
    }

    public List<Announcement> fetchAnnouncements(String code, int page, int pageSize) {
        if (page <= 0) page = 1;
        if (pageSize <= 0) pageSize = 20;
        String key = code + ":" + page + ":" + pageSize;
        List<Announcement> cached = cache.getIfPresent(key);
        if (cached != null) return cached;

        String orgId = marketInfo(code);
        Map<String, String> form = new LinkedHashMap<>();
        form.put("pageNum", String.valueOf(page));
        form.put("pageSize", String.valueOf(pageSize));
        form.put("column", orgId.startsWith("sh") ? "sh" : "sz");
        form.put("tabName", "fulltext");
        form.put("plate", orgId.startsWith("sh") ? "sh" : "sz");
        form.put("stock", code + "," + orgId);
        form.put("searchkey", "");
        form.put("secid", "");
        form.put("category", "");
        form.put("trade", "");
        form.put("seDate", "");

        String body = source.postForm(QUERY_URL, form);
        List<Announcement> items = parse(body);
        cache.put(key, items, Duration.ofMinutes(5));
        return items;
    }

    private List<Announcement> parse(String body) {
        List<Announcement> items = new ArrayList<>();
        try {
            JsonNode arr = MAPPER.readTree(body).path("announcements");
            for (JsonNode n : arr) {
                String id = n.path("announcementId").asText("");
                long ts = n.path("announcementTime").asLong(0);
                items.add(new Announcement(id,
                        n.path("announcementTitle").asText(""),
                        ts > 0 ? DATE_FMT.format(Instant.ofEpochMilli(ts)) : "",
                        "http://www.cninfo.com.cn/new/disclosure/detail?announcementId=" + id,
                        "https://static.cninfo.com.cn/" + n.path("adjunctUrl").asText("").replaceFirst("^/", "")));
            }
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("巨潮公告JSON解析失败", e);
        }
        return items;
    }

    /** 返回 orgId；6 → "gssh0"+code，其他 → "gssz0"+code */
    static String marketInfo(String code) {
        if (code == null || code.isEmpty()) return "gssh0";
        char first = code.charAt(0);
        return first == '6' ? "gssh0" + code : "gssz0" + code;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CninfoClientTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/cninfo src/test/java/com/guyu/stock/external/cninfo
git commit -m "feat: add CNINFO announcement client"
```

---

### Task 7: 板块接口（ConceptRepository + SectorController）

**Files:**
- Create: `src/main/java/com/guyu/stock/sector/ConceptRepository.java`
- Create: `src/main/java/com/guyu/stock/sector/SectorController.java`
- Modify: `src/test/resources/schema.sql`（追加 concept_board / concept_stock 表）
- Test: `src/test/java/com/guyu/stock/sector/ConceptRepositoryTest.java`
- Test: `src/test/java/com/guyu/stock/sector/SectorControllerTest.java`

**Interfaces:**
- Consumes: `ThsClient`（Task 5）、`JdbcTemplate`
- Produces:
  - `record ConceptBoard(String plateCode, String plateName, int cid)`
  - `ConceptRepository.upsertBoard(String plateCode, String plateName, int cid)`
  - `List<ConceptBoard> ConceptRepository.listBoards()`
  - `void ConceptRepository.replaceMembers(String plateCode, List<String> codes)`（先删后插）
  - `List<String> ConceptRepository.getMembers(String plateCode)`
  - `int ConceptRepository.countBoards()`
  - `SectorController`：`GET /api/v1/sector/boards?top=`、`GET /api/v1/sector/board/{code}/klines?count=`、`GET /api/v1/sector/members/{cid}`

**Go 参考**：`backend/handler/sector.go`、`backend/repository/concept.go`

- [ ] **Step 1: 写失败测试**

`schema.sql` 追加：

```sql
CREATE TABLE IF NOT EXISTS concept_board (
    plate_code VARCHAR(20) PRIMARY KEY,
    plate_name VARCHAR(64),
    cid        INT,
    updated_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS concept_stock (
    plate_code VARCHAR(20) NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    PRIMARY KEY (plate_code, stock_code)
);
```

`ConceptRepositoryTest.java`（`@JdbcTest`，验证 upsert/list/replace/getMembers/count）：

```java
package com.guyu.stock.sector;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@JdbcTest
@ActiveProfiles("test")
class ConceptRepositoryTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    private ConceptRepository repo;

    @BeforeEach
    void setUp() {
        repo = new ConceptRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM concept_stock");
        jdbcTemplate.execute("DELETE FROM concept_board");
    }

    @Test
    void upsertAndListBoard() {
        repo.upsertBoard("885333", "人工智能", 300188);
        List<ConceptBoard> boards = repo.listBoards();
        assertThat(boards).hasSize(1);
        assertThat(boards.get(0).plateName()).isEqualTo("人工智能");
        assertThat(repo.countBoards()).isEqualTo(1);
    }

    @Test
    void replaceMembersAndGet() {
        repo.upsertBoard("885333", "人工智能", 300188);
        repo.replaceMembers("885333", List.of("600001", "000001"));
        assertThat(repo.getMembers("885333")).containsExactly("000001", "600001");
    }
}
```

`SectorControllerTest.java`（MockMvc + H2 + stub ThsClient bean）：

```java
package com.guyu.stock.sector;

import com.guyu.stock.external.ths.BoardInfo;
import com.guyu.stock.external.ths.ThsClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SectorControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private ThsClient thsClient;

    @Test
    void boardsFallsBackToThsWhenDbEmpty() throws Exception {
        when(thsClient.fetchBoardList(20)).thenReturn(List.of(new BoardInfo(300188, "885333", "人工智能", 1.5)));
        mockMvc.perform(get("/api/v1/sector/boards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].plate_code").value("885333"))
                .andExpect(jsonPath("$.data[0].plate_name").value("人工智能"));
    }

    @Test
    void boardKlinesReturnsShape() throws Exception {
        mockMvc.perform(get("/api/v1/sector/board/885333/klines").param("count", "30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.code").value("885333"));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=ConceptRepositoryTest,SectorControllerTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`ConceptRepository.java`:

```java
package com.guyu.stock.sector;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

@Repository
public class ConceptRepository {

    public record ConceptBoard(String plateCode, String plateName, int cid) {}

    private final JdbcTemplate jdbcTemplate;

    public ConceptRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<ConceptBoard> BOARD_MAPPER = (rs, i) -> new ConceptBoard(
            rs.getString("plate_code"), rs.getString("plate_name"), rs.getInt("cid"));

    public void upsertBoard(String plateCode, String plateName, int cid) {
        jdbcTemplate.update("""
                INSERT INTO concept_board (plate_code, plate_name, cid, updated_at) VALUES (?,?,?,?)
                ON CONFLICT (plate_code) DO UPDATE SET plate_name=EXCLUDED.plate_name, cid=EXCLUDED.cid, updated_at=EXCLUDED.updated_at
                """, plateCode, plateName, cid, Timestamp.valueOf(LocalDateTime.now()));
    }

    public List<ConceptBoard> listBoards() {
        return jdbcTemplate.query("SELECT plate_code, plate_name, cid FROM concept_board ORDER BY plate_code", BOARD_MAPPER);
    }

    public void replaceMembers(String plateCode, List<String> stockCodes) {
        if (stockCodes == null || stockCodes.isEmpty()) return;
        jdbcTemplate.execute("BEGIN");
        try {
            jdbcTemplate.update("DELETE FROM concept_stock WHERE plate_code = ?", plateCode);
            for (String code : stockCodes) {
                jdbcTemplate.update("INSERT INTO concept_stock (plate_code, stock_code) VALUES (?,?) ON CONFLICT DO NOTHING",
                        plateCode, code);
            }
            jdbcTemplate.execute("COMMIT");
        } catch (RuntimeException e) {
            jdbcTemplate.execute("ROLLBACK");
            throw e;
        }
    }

    public List<String> getMembers(String plateCode) {
        return jdbcTemplate.query("SELECT stock_code FROM concept_stock WHERE plate_code = ? ORDER BY stock_code",
                (rs, i) -> rs.getString(1), plateCode);
    }

    public int countBoards() {
        Integer n = jdbcTemplate.queryForObject("SELECT count(*) FROM concept_board", Integer.class);
        return n == null ? 0 : n;
    }
}
```

**注意**：H2/PostgreSQL 下 `execute("BEGIN")/("COMMIT")` 在 JdbcTemplate 中可行，但更稳妥是 `TransactionTemplate` 或 `@Transactional`。为保持简单且测试通过，`replaceMembers` 用 `jdbcTemplate.execute("BEGIN")...COMMIT`；若 H2 不支持，改为先 `update("DELETE ...")` 再循环 insert（无事务）也可接受（Go 用了事务，Java 简化）。

`SectorController.java`:

```java
package com.guyu.stock.sector;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.ths.BoardInfo;
import com.guyu.stock.external.ths.BoardKLine;
import com.guyu.stock.external.ths.ThsClient;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sector")
public class SectorController {

    private final ConceptRepository conceptRepo;
    private final ThsClient thsClient;

    public SectorController(ConceptRepository conceptRepo, ThsClient thsClient) {
        this.conceptRepo = conceptRepo;
        this.thsClient = thsClient;
    }

    @GetMapping("/boards")
    public ApiResponse<?> listBoards(@RequestParam(value = "top", required = false) Integer top) {
        List<ConceptRepository.ConceptBoard> boards = conceptRepo.listBoards();
        if (boards != null && !boards.isEmpty()) {
            return ApiResponse.success(boards);
        }
        int topN = (top == null || top <= 0) ? 20 : Math.min(top, 100);
        return ApiResponse.success(thsClient.fetchBoardList(topN));
    }

    @GetMapping("/board/{code}/klines")
    public ApiResponse<Map<String, Object>> boardKlines(@PathVariable("code") String code,
                                                        @RequestParam(value = "count", required = false) Integer count) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "板块代码不能为空");
        }
        int n = (count == null || count <= 0) ? 30 : count;
        List<BoardKLine> klines = thsClient.fetchBoardKLine(code, n);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("count", klines.size());
        result.put("klines", klines);
        return ApiResponse.success(result);
    }

    @GetMapping("/members/{cid}")
    public ApiResponse<Map<String, Object>> members(@PathVariable("cid") String cidStr) {
        int cid;
        try {
            cid = Integer.parseInt(cidStr);
        } catch (NumberFormatException e) {
            throw new BizException(ErrCode.INVALID_PARAM, "cid 必须是数字");
        }
        String plateCode = null;
        for (ConceptRepository.ConceptBoard b : conceptRepo.listBoards()) {
            if (b.cid() == cid) { plateCode = b.plateCode(); break; }
        }
        List<String> codes = null;
        if (plateCode != null) {
            codes = conceptRepo.getMembers(plateCode);
            if (codes == null || codes.isEmpty()) codes = null;
        }
        if (codes == null) {
            codes = thsClient.fetchMembers(cid);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("cid", cid);
        result.put("count", codes.size());
        result.put("stocks", codes);
        return ApiResponse.success(result);
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=ConceptRepositoryTest,SectorControllerTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/sector src/test/java/com/guyu/stock/sector src/test/resources/schema.sql
git commit -m "feat: add sector endpoints (boards, board klines, members)"
```

---

### Task 8: 新闻接口（NewsRepository + NewsController + @Async）

**Files:**
- Create: `src/main/java/com/guyu/stock/news/NewsRepository.java`
- Create: `src/main/java/com/guyu/stock/news/AsyncNewsSaver.java`
- Create: `src/main/java/com/guyu/stock/news/NewsController.java`
- Modify: `src/main/java/com/guyu/stock/StockApplication.java`（加 `@EnableAsync`）
- Modify: `src/test/resources/schema.sql`（追加 news_feed 表）
- Test: `src/test/java/com/guyu/stock/news/NewsRepositoryTest.java`
- Test: `src/test/java/com/guyu/stock/news/NewsControllerTest.java`

**Interfaces:**
- Consumes: `SinaNewsClient`（Task 4）、`CninfoClient`（Task 6）、`JdbcTemplate`
- Produces:
  - `record NewsRow(String stockCode, String title, String summary, String url, String source, String publishedAt)`
  - `NewsRepository.batchSave(List<NewsRow>)`（ON CONFLICT DO NOTHING）
  - `List<NewsRow> NewsRepository.queryByStock(String code, int limit)`
  - `AsyncNewsSaver.save(List<NewsRow>)`（`@Async`，失败仅日志）
  - `NewsController`：`GET /api/v1/stock/{code}/news?page=`、`GET /api/v1/news/feed?q=&count=`、`GET /api/v1/stock/{code}/announcements?page=&size=`

**Go 参考**：`backend/handler/news.go`、`backend/repository/news.go`

- [ ] **Step 1: 写失败测试**

`schema.sql` 追加：

```sql
CREATE TABLE IF NOT EXISTS news_feed (
    id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    stock_code   VARCHAR(10),
    title        VARCHAR(512),
    summary      TEXT,
    url          VARCHAR(1024),
    source       VARCHAR(64),
    published_at TIMESTAMPTZ
);
```

`NewsRepositoryTest.java`:

```java
package com.guyu.stock.news;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@JdbcTest
@ActiveProfiles("test")
class NewsRepositoryTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    private NewsRepository repo;

    @BeforeEach
    void setUp() {
        repo = new NewsRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM news_feed");
    }

    @Test
    void batchSaveAndQueryByStock() {
        repo.batchSave(List.of(
                new NewsRepository.NewsRow("600519", "标题1", "摘要", "http://u/1", "新浪", "2026-08-05 10:30"),
                new NewsRepository.NewsRow("600519", "标题2", "", "http://u/2", "新浪", "2026-08-06 09:00")));
        List<NewsRepository.NewsRow> rows = repo.queryByStock("600519", 10);
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).title()).isEqualTo("标题2"); // 倒序
    }
}
```

`NewsControllerTest.java`（stub SinaNewsClient + CninfoClient bean）：

```java
package com.guyu.stock.news;

import com.guyu.stock.external.cninfo.Announcement;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NewsControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private SinaNewsClient sinaNewsClient;
    @MockBean private CninfoClient cninfoClient;

    @Test
    void stockNewsReturnsShape() throws Exception {
        when(sinaNewsClient.fetchStockNews(anyString(), anyInt()))
                .thenReturn(List.of(new SinaNewsClient.NewsItem("标题", "摘要", "http://u", "2026-08-05 10:30", "新浪")));
        mockMvc.perform(get("/api/v1/stock/600519/news"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.count").value(1))
                .andExpect(jsonPath("$.data.news[0].title").value("标题"));
    }

    @Test
    void announcementsReturnsShape() throws Exception {
        when(cninfoClient.fetchAnnouncements(anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(new Announcement("a1", "年报", "2026-08-05", "http://u", "http://pdf")));
        mockMvc.perform(get("/api/v1/stock/600519/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].title").value("年报"));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=NewsRepositoryTest,NewsControllerTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`NewsRepository.java`:

```java
package com.guyu.stock.news;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class NewsRepository {

    public record NewsRow(String stockCode, String title, String summary, String url, String source, String publishedAt) {}

    private final JdbcTemplate jdbcTemplate;

    public NewsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<NewsRow> MAPPER = (rs, i) -> new NewsRow(
            rs.getString("stock_code"), rs.getString("title"), rs.getString("summary"),
            rs.getString("url"), rs.getString("source"), rs.getString("published_at"));

    public void batchSave(List<NewsRow> rows) {
        if (rows == null || rows.isEmpty()) return;
        for (NewsRow row : rows) {
            jdbcTemplate.update("""
                    INSERT INTO news_feed (stock_code, title, summary, url, source, published_at)
                    VALUES (?,?,?,?,?,CAST(? AS TIMESTAMPTZ))
                    ON CONFLICT DO NOTHING
                    """, row.stockCode(), row.title(), row.summary(), row.url(), row.source(), row.publishedAt());
        }
    }

    public List<NewsRow> queryByStock(String code, int limit) {
        if (limit <= 0) limit = 50;
        return jdbcTemplate.query("""
                SELECT stock_code, title, summary, url, source,
                       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
                FROM news_feed WHERE stock_code = ? ORDER BY published_at DESC LIMIT ?
                """, MAPPER, code, limit);
    }
}
```

`AsyncNewsSaver.java`:

```java
package com.guyu.stock.news;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class AsyncNewsSaver {

    private static final Logger log = LoggerFactory.getLogger(AsyncNewsSaver.class);

    private final NewsRepository newsRepository;

    public AsyncNewsSaver(NewsRepository newsRepository) {
        this.newsRepository = newsRepository;
    }

    @Async
    public void save(List<NewsRepository.NewsRow> rows) {
        try {
            newsRepository.batchSave(rows);
        } catch (Exception e) {
            log.warn("异步存库失败: {}", e.getMessage(), e);
        }
    }
}
```

`NewsController.java`:

```java
package com.guyu.stock.news;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.cninfo.Announcement;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class NewsController {

    private final SinaNewsClient sinaNewsClient;
    private final CninfoClient cninfoClient;
    private final AsyncNewsSaver asyncNewsSaver;

    public NewsController(SinaNewsClient sinaNewsClient, CninfoClient cninfoClient, AsyncNewsSaver asyncNewsSaver) {
        this.sinaNewsClient = sinaNewsClient;
        this.cninfoClient = cninfoClient;
        this.asyncNewsSaver = asyncNewsSaver;
    }

    @GetMapping("/stock/{code}/news")
    public ApiResponse<Map<String, Object>> stockNews(@PathVariable("code") String code,
                                                      @RequestParam(value = "page", required = false) Integer page) {
        if (code == null || code.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        int p = (page == null || page <= 0) ? 1 : page;
        List<SinaNewsClient.NewsItem> items = sinaNewsClient.fetchStockNews(code, p);
        asyncNewsSaver.save(toRows(code, items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("count", items.size());
        result.put("news", items);
        return ApiResponse.success(result);
    }

    @GetMapping("/news/feed")
    public ApiResponse<Map<String, Object>> feed(@RequestParam(value = "q", required = false) String q,
                                                 @RequestParam(value = "count", required = false) Integer count) {
        String keyword = (q == null || q.isBlank()) ? "A股" : q;
        int n = (count == null || count <= 0) ? 20 : Math.min(count, 100);
        List<SinaNewsClient.NewsItem> items = sinaNewsClient.fetchFeedNews(keyword, n);
        asyncNewsSaver.save(toRows("", items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("keyword", keyword);
        result.put("count", items.size());
        result.put("news", items);
        return ApiResponse.success(result);
    }

    @GetMapping("/stock/{code}/announcements")
    public ApiResponse<Map<String, Object>> announcements(@PathVariable("code") String code,
                                                          @RequestParam(value = "page", required = false) Integer page,
                                                          @RequestParam(value = "size", required = false) Integer size) {
        if (code == null || code.isBlank()) throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        int p = (page == null || page <= 0) ? 1 : page;
        int s = (size == null || size <= 0) ? 20 : Math.min(size, 100);
        List<Announcement> items = cninfoClient.fetchAnnouncements(code, p, s);
        asyncNewsSaver.save(toRows(code, items));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("page", p);
        result.put("count", items.size());
        result.put("items", items);
        return ApiResponse.success(result);
    }

    private List<NewsRepository.NewsRow> toRows(String code, List<SinaNewsClient.NewsItem> items) {
        List<NewsRepository.NewsRow> rows = new ArrayList<>();
        for (SinaNewsClient.NewsItem n : items) {
            rows.add(new NewsRepository.NewsRow(code, n.title(), n.summary(), n.url(), n.source(), n.time()));
        }
        return rows;
    }

    private List<NewsRepository.NewsRow> toRows(String code, List<Announcement> items) {
        List<NewsRepository.NewsRow> rows = new ArrayList<>();
        for (Announcement a : items) {
            rows.add(new NewsRepository.NewsRow(code, a.title(), "", a.url(), "巨潮资讯", a.time()));
        }
        return rows;
    }
}
```

`StockApplication.java` 加 `@EnableAsync`（import `org.springframework.scheduling.annotation.EnableAsync`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=NewsRepositoryTest,NewsControllerTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/news src/main/java/com/guyu/stock/StockApplication.java src/test/java/com/guyu/stock/news src/test/resources/schema.sql
git commit -m "feat: add news endpoints (stock news, feed, announcements) with async save"
```

---

### Task 9: K 线完整化（分钟线 + 日线回退）

**Files:**
- Modify: `src/main/java/com/guyu/stock/stock/StockKlineRepository.java`（加 `batchUpsert`）
- Modify: `src/main/java/com/guyu/stock/stock/StockService.java`（加分钟线 + 日线回退）
- Modify: `src/main/java/com/guyu/stock/stock/StockController.java`（放开 scale + 接入 SinaKlineClient）
- Modify: `src/main/java/com/guyu/stock/config/BeanConfig.java`（加 SinaKlineClient / SinaInfoClient / SinaNewsClient / ThsClient / CninfoClient bean）
- Test: `src/test/java/com/guyu/stock/stock/KlineFallbackTest.java`

**Interfaces:**
- Consumes: `SinaKlineClient`（Task 2）、`StockKlineRepository`
- Produces:
  - `void StockKlineRepository.batchUpsert(List<StockKline>)`（ON CONFLICT）
  - `Map<String,Object> StockService.getKlines(String code, String scale, int count)`：DB 周期 240/1200 → DB → 未命中回退 Sina；分钟线 → Sina
  - `StockController` 不再拒绝非 240/1200

**Go 参考**：`backend/handler/stock.go`（`getDBKLine` 回退 + `go func()` 异步回填）、`backend/pkg/sina/kline.go`

- [ ] **Step 1: 写失败测试**

`KlineFallbackTest.java`（stub SinaKlineClient + H2）：

```java
package com.guyu.stock.stock;

import com.guyu.stock.external.sina.SinaKlineClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class KlineFallbackTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private SinaKlineClient sinaKlineClient;

    @Test
    void minuteScaleFetchesFromSina() throws Exception {
        when(sinaKlineClient.getKLine(anyString(), anyString(), anyInt()))
                .thenReturn(new SinaKlineClient.KLineResult("600519", "60",
                        List.of(new SinaKlineClient.KLine("2026-08-05 14:55:00", 1700, 1720, 1690, 1710, 10000)), 1));
        mockMvc.perform(get("/api/v1/stock/600519/klines").param("scale", "60").param("count", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scale").value("60"))
                .andExpect(jsonPath("$.data.klines[0].time").value("2026-08-05 14:55:00"));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=KlineFallbackTest`
Expected: FAIL（StockController 目前拒绝 60 scale）

- [ ] **Step 3: 实现**

`StockKlineRepository` 追加：

```java
public void batchUpsert(List<StockKline> klines) {
    if (klines == null || klines.isEmpty()) return;
    for (StockKline k : klines) {
        jdbcTemplate.update("""
                INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount, turnover, pct_change, change_amt, amplitude, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT (code, scale, trade_date) DO UPDATE SET
                    open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close,
                    volume=EXCLUDED.volume, amount=EXCLUDED.amount, turnover=EXCLUDED.turnover,
                    pct_change=EXCLUDED.pct_change, change_amt=EXCLUDED.change_amt, amplitude=EXCLUDED.amplitude,
                    created_at=EXCLUDED.created_at
                """,
                k.code(), k.scale(), java.sql.Date.valueOf(k.tradeDate()), k.open(), k.high(), k.low(), k.close(),
                k.volume(), k.amount(), k.turnover(), k.pctChange(), k.changeAmt(), k.amplitude(),
                java.sql.Timestamp.valueOf(java.time.LocalDateTime.now()));
    }
}
```

`StockService` 追加 `sinaKlineClient` 依赖与分钟线/回退逻辑：

```java
private final SinaKlineClient sinaKlineClient;

// 构造器加参数

public Map<String, Object> getKlines(String code, String scale, int count) {
    if (count <= 0) count = 100;
    if (isDbKline(scale)) {
        Map<String, Object> fromDb = getDbKlines(code, scale, count);
        if (fromDb != null) return fromDb;
        // DB 未命中 → 回退新浪（日线）
        SinaKlineClient.KLineResult sina = sinaKlineClient.getKLine(code, scale, count);
        asyncBackfill(code, scale, sina);
        return result(code, scale, toApiKlines(sina.klines()));
    }
    // 分钟线 → 新浪
    SinaKlineClient.KLineResult sina = sinaKlineClient.getKLine(code, scale, count);
    return result(code, scale, toApiKlines(sina.klines()));
}

private Map<String, Object> getDbKlines(String code, String scale, int count) {
    String dbScale = scaleToDb(scale);
    List<StockKline> rows = klineRepository.queryByCode(code, dbScale, count);
    if (rows == null || rows.isEmpty()) return null;
    List<Map<String, Object>> klines = new ArrayList<>();
    for (int i = rows.size() - 1; i >= 0; i--) {
        StockKline k = rows.get(i);
        klines.add(klineItem(k.tradeDate().toString(), k.open(), k.high(), k.low(), k.close(), k.volume()));
    }
    return result(code, scale, klines);
}

private void asyncBackfill(String code, String scale, SinaKlineClient.KLineResult sina) {
    try {
        String dbScale = scaleToDb(scale);
        List<StockKline> dbRows = toDbKlines(code, dbScale, sina.klines());
        if (!dbRows.isEmpty()) klineRepository.batchUpsert(dbRows);
    } catch (Exception e) {
        // 对齐 Go go func() 异步回填，失败不影响响应
    }
}
```

`toApiKlines`/`klineItem`/`toDbKlines`/`result` 为私有工具（`klineItem` 构造 `{time,open,high,low,close,volume}` LinkedHashMap；`toDbKlines` 计算涨跌幅/额/振幅，对齐 Go `sinaKlinesToDB`）。

`StockController` 改造：删除 `if (!StockService.isDbKline(scale)) throw ...` 分支，其余不变（构造器已由 BeanConfig 提供 SinaKlineClient）。

`BeanConfig` 追加所有数据源 bean：

```java
@Bean public SinaKlineClient sinaKlineClient(DataSource sinaSource) {
    return new SinaKlineClient(sinaSource, 1000);
}
@Bean public SinaInfoClient sinaInfoClient(DataSource sinaSource) { return new SinaInfoClient(sinaSource); }
@Bean public SinaNewsClient sinaNewsClient(DataSource sinaSource) { return new SinaNewsClient(sinaSource, 1000); }
@Bean public ThsClient thsClient(DataSource thsSource) { return new ThsClient(thsSource, 1000); }
@Bean public CninfoClient cninfoClient(DataSource cninfoSource) { return new CninfoClient(cninfoSource, 1000); }
@Bean public DataSource sinaSource() { return DataSource.sina(); }
@Bean public DataSource thsSource() { return DataSource.ths(); }
@Bean public DataSource cninfoSource() { return DataSource.cninfo(); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=KlineFallbackTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/stock src/main/java/com/guyu/stock/config/BeanConfig.java src/test/java/com/guyu/stock/stock/KlineFallbackTest.java
git commit -m "feat: add minute klines and sina fallback for daily klines"
```

---

### Task 10: 采集服务（CollectorService + StockInfoRepo.batchUpsert）

**Files:**
- Create: `src/main/java/com/guyu/stock/collector/CollectorProperties.java`
- Create: `src/main/java/com/guyu/stock/collector/CollectorService.java`
- Modify: `src/main/java/com/guyu/stock/stock/StockInfoRepository.java`（加 `batchUpsert`）
- Modify: `src/main/resources/application.yml`（加 `app.collector.*`）
- Test: `src/test/java/com/guyu/stock/collector/CollectorServiceTest.java`

**Interfaces:**
- Consumes: `SinaInfoClient`（Task 3）、`SinaKlineClient`（Task 2）、`ThsClient`（Task 5）、`StockInfoRepository`、`StockKlineRepository`、`ConceptRepository`
- Produces:
  - `record CollectorProperties(boolean autoFull, int sampleSize)`（`@ConfigurationProperties("app.collector")`）
  - `void CollectorService.refreshStockInfo()`
  - `void CollectorService.refreshConceptData()`
  - `int CollectorService.runFull(int sampleSize)`（返回处理股票数；sampleSize<=0 处理全部）
  - `void StockInfoRepository.batchUpsert(List<StockInfo>)`

**Go 参考**：`backend/service/collector.go`、`backend/repository/stock_info.go`（BatchUpsert）

- [ ] **Step 1: 写失败测试**

`CollectorServiceTest.java`（stub 各客户端，H2）：

```java
package com.guyu.stock.collector;

import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.sector.ConceptRepository;
import com.guyu.stock.stock.StockInfoRepository;
import com.guyu.stock.stock.StockKlineRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
class CollectorServiceTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private StockInfoRepository stockInfoRepository;
    @Autowired private StockKlineRepository stockKlineRepository;
    @Autowired private ConceptRepository conceptRepository;

    @MockBean private SinaInfoClient sinaInfoClient;
    @MockBean private SinaKlineClient sinaKlineClient;
    @MockBean private ThsClient thsClient;

    @Test
    void refreshStockInfoUpsertsIntoDb() {
        when(sinaInfoClient.fetchStockList()).thenReturn(List.of(
                new SinaInfoClient.SinaStock("600519", "贵州茅台", "sh", "main")));
        when(sinaInfoClient.fetchIndustryMap()).thenReturn(Map.of("600519", "白酒"));

        CollectorService service = new CollectorService(sinaInfoClient, sinaKlineClient, thsClient,
                stockInfoRepository, stockKlineRepository, conceptRepository);
        service.refreshStockInfo();

        var rows = jdbcTemplate.queryForList("SELECT code, industry FROM stock_info WHERE code='600519'");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("industry")).isEqualTo("白酒");
    }

    @Test
    void runFullWithSampleUpsertsKlines() {
        when(sinaInfoClient.fetchStockList()).thenReturn(List.of(
                new SinaInfoClient.SinaStock("600001", "A", "sh", "main"),
                new SinaInfoClient.SinaStock("000001", "B", "sz", "main")));
        when(sinaInfoClient.fetchIndustryMap()).thenReturn(Map.of());
        when(sinaKlineClient.getKLine(anyString(), anyString(), anyInt())).thenReturn(
                new SinaKlineClient.KLineResult("600001", "240",
                        List.of(new SinaKlineClient.KLine("2026-08-05", 10, 11, 9, 10.5, 1000)), 1));

        CollectorService service = new CollectorService(sinaInfoClient, sinaKlineClient, thsClient,
                stockInfoRepository, stockKlineRepository, conceptRepository);
        int processed = service.runFull(1); // 只处理前 1 只
        assertThat(processed).isEqualTo(1);

        var rows = jdbcTemplate.queryForList("SELECT code FROM stock_kline WHERE code='600001' AND scale='1d'");
        assertThat(rows).hasSize(1);
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CollectorServiceTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`CollectorProperties.java`:

```java
package com.guyu.stock.collector;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.collector")
public class CollectorProperties {
    private boolean autoFull = false;
    private int sampleSize = 20;
    public boolean isAutoFull() { return autoFull; }
    public void setAutoFull(boolean autoFull) { this.autoFull = autoFull; }
    public int getSampleSize() { return sampleSize; }
    public void setSampleSize(int sampleSize) { this.sampleSize = sampleSize; }
}
```

`StockInfoRepository` 追加 `batchUpsert`：

```java
public void batchUpsert(List<StockInfo> infos) {
    if (infos == null || infos.isEmpty()) return;
    for (StockInfo info : infos) {
        jdbcTemplate.update("""
                INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT (code) DO UPDATE SET
                    name=EXCLUDED.name, type=EXCLUDED.type, market=EXCLUDED.market, board=EXCLUDED.board,
                    industry=EXCLUDED.industry, is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at
                """,
                info.code(), info.name(), "stock", info.market(), info.board(), info.industry(),
                true, java.sql.Timestamp.valueOf(java.time.LocalDateTime.now()));
    }
}
```

`CollectorService.java`:

```java
package com.guyu.stock.collector;

import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.sector.ConceptRepository;
import com.guyu.stock.stock.StockInfo;
import com.guyu.stock.stock.StockInfoRepository;
import com.guyu.stock.stock.StockKline;
import com.guyu.stock.stock.StockKlineRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class CollectorService {

    private static final Logger log = LoggerFactory.getLogger(CollectorService.class);

    private final SinaInfoClient sinaInfoClient;
    private final SinaKlineClient sinaKlineClient;
    private final ThsClient thsClient;
    private final StockInfoRepository stockInfoRepository;
    private final StockKlineRepository stockKlineRepository;
    private final ConceptRepository conceptRepository;

    public CollectorService(SinaInfoClient sinaInfoClient, SinaKlineClient sinaKlineClient, ThsClient thsClient,
                            StockInfoRepository stockInfoRepository, StockKlineRepository stockKlineRepository,
                            ConceptRepository conceptRepository) {
        this.sinaInfoClient = sinaInfoClient;
        this.sinaKlineClient = sinaKlineClient;
        this.thsClient = thsClient;
        this.stockInfoRepository = stockInfoRepository;
        this.stockKlineRepository = stockKlineRepository;
        this.conceptRepository = conceptRepository;
    }

    /** 对齐 Go RefreshStockInfo：股票列表 + 行业分类 → stock_info */
    public void refreshStockInfo() {
        log.info("[采集] 开始刷新股票信息");
        List<SinaInfoClient.SinaStock> stocks = sinaInfoClient.fetchStockList();
        Map<String, String> industryMap;
        try {
            industryMap = sinaInfoClient.fetchIndustryMap();
        } catch (Exception e) {
            log.warn("[采集] 行业分类拉取失败（非致命）: {}", e.getMessage());
            industryMap = Map.of();
        }
        List<StockInfo> infos = new ArrayList<>();
        for (SinaInfoClient.SinaStock s : stocks) {
            infos.add(new StockInfo(s.code(), s.name(), "stock", s.market(), s.board(),
                    industryMap.getOrDefault(s.code(), null), true, null));
        }
        stockInfoRepository.batchUpsert(infos);
        log.info("[采集] 股票信息刷新完成，{} 条", infos.size());
    }

    /** 对齐 Go RefreshConceptData：板块列表 + 成分股 → concept_board/concept_stock */
    public void refreshConceptData() {
        log.info("[采集] 开始刷新概念板块");
        List<com.guyu.stock.external.ths.BoardInfo> boards = thsClient.fetchBoardList(500);
        int savedBoards = 0;
        for (com.guyu.stock.external.ths.BoardInfo b : boards) {
            try {
                conceptRepository.upsertBoard(b.plateCode(), b.plateName(), b.cid());
                savedBoards++;
                if (b.cid() > 0) {
                    List<String> codes = thsClient.fetchMembers(b.cid());
                    if (!codes.isEmpty()) conceptRepository.replaceMembers(b.plateCode(), codes);
                }
            } catch (Exception e) {
                log.warn("[采集] 板块 {} 处理失败: {}", b.plateCode(), e.getMessage());
            }
        }
        log.info("[采集] 概念板块刷新完成：{} 个板块", savedBoards);
    }

    /** 对齐 Go RunFull，sampleSize<=0 处理全部；返回处理股票数 */
    public int runFull(int sampleSize) {
        log.info("[采集] 开始全量采集（含日K线）");
        refreshStockInfo();
        List<com.guyu.stock.external.sina.SinaKlineClient.KLineResult> results = new ArrayList<>();
        List<SinaInfoClient.SinaStock> stocks = new ArrayList<>();
        try {
            stocks = allStocks();
        } catch (Exception e) {
            log.warn("[采集] 股票列表拉取失败: {}", e.getMessage());
            return 0;
        }
        int limit = (sampleSize > 0 && sampleSize < stocks.size()) ? sampleSize : stocks.size();
        int saved = 0;
        for (int i = 0; i < limit; i++) {
            SinaInfoClient.SinaStock s = stocks.get(i);
            if (!"sh".equals(s.market()) && !"sz".equals(s.market())) continue;
            try {
                SinaKlineClient.KLineResult r = sinaKlineClient.getKLine(s.code(), "240", 60);
                if (r.klines().isEmpty()) continue;
                stockKlineRepository.batchUpsert(toDbKlines(s.code(), r.klines()));
                saved++;
            } catch (Exception e) {
                log.warn("[采集] {} 拉取失败: {}", s.code(), e.getMessage());
            }
        }
        log.info("[采集] K线写入完成，共保存 {} 只股票", saved);
        return saved;
    }

    private List<SinaInfoClient.SinaStock> allStocks() {
        return sinaInfoClient.fetchStockList();
    }

    private List<StockKline> toDbKlines(String code, List<SinaKlineClient.KLine> klines) {
        List<StockKline> result = new ArrayList<>();
        double prevClose = 0;
        for (SinaKlineClient.KLine k : klines) {
            LocalDate date = LocalDate.parse(k.time().substring(0, 10));
            double amount = round2((k.open() + k.high() + k.low() + k.close()) / 4 * k.volume());
            double changeAmt = 0, pctChange = 0, amplitude = 0;
            if (prevClose != 0) {
                changeAmt = round2(k.close() - prevClose);
                pctChange = round2((k.close() - prevClose) / prevClose * 100);
                amplitude = round2((k.high() - k.low()) / prevClose * 100);
            }
            result.add(new StockKline(code, "1d", date, k.open(), k.high(), k.low(), k.close(), k.volume(),
                    amount, 0, pctChange, changeAmt, amplitude));
            prevClose = k.close();
        }
        return result;
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
```

`application.yml` 追加：

```yaml
app:
  collector:
    auto-full: false
    sample-size: 20
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CollectorServiceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/collector src/main/java/com/guyu/stock/stock/StockInfoRepository.java src/main/resources/application.yml src/test/java/com/guyu/stock/collector
git commit -m "feat: add data collector service with sample-size support"
```

---

### Task 11: 定时调度 + 启动自检

**Files:**
- Create: `src/main/java/com/guyu/stock/collector/CollectorScheduler.java`
- Modify: `src/main/java/com/guyu/stock/StockApplication.java`（加 `@EnableScheduling`）
- Test: `src/test/java/com/guyu/stock/collector/CollectorSchedulerTest.java`

**Interfaces:**
- Consumes: `CollectorService`（Task 10）、`CollectorProperties`（Task 10）、`ConceptRepository`、`StockInfoRepository`
- Produces: `CollectorScheduler`（@Scheduled 9:00/9:05/15:30 + ApplicationRunner 自检）

**Go 参考**：`backend/main.go`（cron 9:00/9:05/15:30 + 启动 goroutine 自检）

- [ ] **Step 1: 写失败测试**

`CollectorSchedulerTest.java`（只验证 auto-full=false 时 15:30 逻辑跳过的可测行为 —— 直接测 `shouldRunFull` 辅助逻辑）：

```java
package com.guyu.stock.collector;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CollectorSchedulerTest {

    @Test
    void autoFullFalseSkipsRunFull() {
        CollectorProperties props = new CollectorProperties();
        props.setAutoFull(false);
        CollectorScheduler.Trigger decision = CollectorScheduler.decideFull(props);
        assertThat(decision).isEqualTo(CollectorScheduler.Trigger.SKIP);
    }

    @Test
    void autoFullTrueRunsFull() {
        CollectorProperties props = new CollectorProperties();
        props.setAutoFull(true);
        assertThat(CollectorScheduler.decideFull(props)).isEqualTo(CollectorScheduler.Trigger.RUN);
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CollectorSchedulerTest`
Expected: FAIL

- [ ] **Step 3: 实现**

`CollectorScheduler.java`:

```java
package com.guyu.stock.collector;

import com.guyu.stock.sector.ConceptRepository;
import com.guyu.stock.stock.StockInfoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CollectorScheduler implements ApplicationRunner {

    public enum Trigger { RUN, SKIP }

    private static final Logger log = LoggerFactory.getLogger(CollectorScheduler.class);

    private final CollectorService collectorService;
    private final CollectorProperties props;
    private final StockInfoRepository stockInfoRepository;
    private final ConceptRepository conceptRepository;

    public CollectorScheduler(CollectorService collectorService, CollectorProperties props,
                              StockInfoRepository stockInfoRepository, ConceptRepository conceptRepository) {
        this.collectorService = collectorService;
        this.props = props;
        this.stockInfoRepository = stockInfoRepository;
        this.conceptRepository = conceptRepository;
    }

    /** 纯逻辑便于测试：auto-full 决定 15:30 是否触发全量 */
    public static Trigger decideFull(CollectorProperties props) {
        return props.isAutoFull() ? Trigger.RUN : Trigger.SKIP;
    }

    @Scheduled(cron = "0 0 9 * * MON-FRI")
    public void refreshStockInfoDaily() {
        try { collectorService.refreshStockInfo(); } catch (Exception e) { log.error("9:00 刷新股票信息失败", e); }
    }

    @Scheduled(cron = "0 5 9 * * MON-FRI")
    public void refreshConceptDaily() {
        try { collectorService.refreshConceptData(); } catch (Exception e) { log.error("9:05 刷新概念板块失败", e); }
    }

    @Scheduled(cron = "0 30 15 * * MON-FRI")
    public void runFullDaily() {
        if (decideFull(props) == Trigger.SKIP) {
            log.info("[定时任务] auto-full=false，跳过 15:30 全量采集");
            return;
        }
        try { collectorService.runFull(0); } catch (Exception e) { log.error("15:30 全量采集失败", e); }
    }

    @Override
    public void run(ApplicationArguments args) {
        // 启动自检：stock_info 空则跑（auto-full 控制是否全量）；concept_board 空则刷板块
        try {
            if (stockInfoRepository.count() == 0) {
                log.info("[启动] stock_info 为空，自动执行采集");
                if (decideFull(props) == Trigger.RUN) {
                    collectorService.runFull(0);
                } else {
                    collectorService.refreshStockInfo();
                    log.info("[启动] auto-full=false，仅刷新股票信息");
                }
            }
        } catch (Exception e) {
            log.error("[启动] stock_info 自检失败", e);
        }
        try {
            if (conceptRepository.countBoards() == 0) {
                log.info("[启动] 概念板块为空，自动采集");
                collectorService.refreshConceptData();
            }
        } catch (Exception e) {
            log.error("[启动] 概念板块自检失败", e);
        }
    }
}
```

`StockInfoRepository` 追加 `count()`：

```java
public int count() {
    Integer n = jdbcTemplate.queryForObject("SELECT count(*) FROM stock_info WHERE is_active=true", Integer.class);
    return n == null ? 0 : n;
}
```

`StockApplication` 加 `@EnableScheduling`。

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn -s .../central-maven-settings.xml -nsu test -Dtest=CollectorSchedulerTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/collector/CollectorScheduler.java src/main/java/com/guyu/stock/stock/StockInfoRepository.java src/main/java/com/guyu/stock/StockApplication.java src/test/java/com/guyu/stock/collector/CollectorSchedulerTest.java
git commit -m "feat: add collector scheduler with auto-full gate and startup self-check"
```

---

### Task 12: 集成验证 + README 更新

**Files:**
- Modify: `backend-java/README.md`（补 C 阶段接口/配置）
- Modify: `backend-java/scripts/verify-b-phase.sh`（补 sector/news/分钟线检查项，或新增 verify-c-phase.sh）

**Interfaces:**
- Consumes: 前 11 个任务全部产物

- [ ] **Step 1: 全量单测**

Run: `cd backend-java && mvn -s .../central-maven-settings.xml -nsu test`
Expected: 全部 PASS（B 阶段 19 + C 阶段新增）

- [ ] **Step 2: 更新 README**

`backend-java/README.md` 追加：
- C 阶段接口清单：sector boards / board klines / members、stock news / feed / announcements、分钟线 klines
- 配置 `app.collector.auto-full` / `sample-size` 说明
- 定时任务说明（9:00/9:05/15:30 + 启动自检）

- [ ] **Step 3: 扩展验证脚本**

`backend-java/scripts/verify-b-phase.sh` 追加检查项（或新增 `verify-c-phase.sh`）：
- `GET /api/v1/sector/boards` → `{code:200, data:[{plate_code,...}]}`
- `GET /api/v1/sector/board/885333/klines?count=5` → `{code:200, data.klines}`
- `GET /api/v1/stock/600519/klines?scale=60&count=5` → `{code:200, data.scale=60}`（分钟线）
- `GET /api/v1/news/feed?q=A股&count=3` → `{code:200, data.news}`
- `GET /api/v1/stock/600519/announcements` → `{code:200, data.items}`
- 手动采集验证：`mvn spring-boot:run` 时加 `--app.collector.run-sample-on-start=true`（如实现）或临时把 `sample-size` 调小后调用管理触发；至少验证 `auto-full:false` 时启动不自检跑全量

- [ ] **Step 4: 提交**

```bash
git add backend-java/README.md backend-java/scripts
git commit -m "docs: add C-phase endpoints and collector config to README and verification"
```

---

## Self-Review

**Spec coverage：**
- sector 3 接口 ✓（Task 7）｜news 3 接口 ✓（Task 8）｜K线分钟+回退 ✓（Task 9）｜采集三功能 ✓（Task 10）｜定时+启动自检 ✓（Task 11）｜集成验证 ✓（Task 12）
- `auto-full:false` + 小样本 ✓（Task 10/11/12）
- fetcher 通用组件 ✓（Task 1）｜sina/ths/cninfo 客户端 ✓（Task 2-6）
- 异步存库 @Async ✓（Task 8）
- 东财不移植 ✓（明确排除）

**类型一致性：**
- `DataSource` 构造器/工厂在 Task 1 定义，Task 2-6 客户端构造器消费一致
- `SinaKlineClient.KLineResult`/`KLine` record 在 Task 2 定义，Task 9/10 引用一致
- `SinaNewsClient.NewsItem`/`CninfoClient.Announcement` 在 Task 4/6 定义，Task 8 引用一致
- `ThsClient.fetchBoardList/fetchBoardKLine/fetchMembers` 在 Task 5 定义，Task 7/10 引用一致
- `ConceptRepository`/`NewsRepository` 方法签名在 Task 7/8 定义，Task 10/11 引用一致

**潜在注意（实现时需微调）：**
- Task 7 `replaceMembers` 的事务用 `execute("BEGIN")...COMMIT`，若 H2/Spring 事务管理不配合，改为 `@Transactional` 或简化无事务
- Task 9 需要 `StockService` 构造器加 `SinaKlineClient`，`StockController` 构造器不变（仍只依赖 StockService）；`toDbKlines`/`klineItem` 工具方法需补齐
- Task 10 `CollectorService.runFull` 里 `results` 变量多余，实现时可移除
- BeanConfig 里数据源 bean（sinaSource/thsSource/cninfoSource）命名避免与 B 阶段 SinaClient 冲突——B 阶段已有 `SinaClient` bean 用 `sinaClient` 名称，这里新增 `sinaSource` 等区分
