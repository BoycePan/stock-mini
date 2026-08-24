# 打点接口区域字段（region）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让打点接口 `POST /api/v1/track/events` 支持用户区域：前端传 `region` 原样落库，否则后端按客户端 IP 离线解析归属地（省-市）兜底，落 `click_event.region` 列。

**Architecture:** `TrackService` 组装入库行时按「前端 region 非空优先，否则 `RegionResolver.resolve(ip)` 兜底」取值。`RegionResolver` 为接口抽象，`Ip2RegionResolver` 为离线实现（`org.lionsoul:ip2region:3.3.7` + 打包 classpath 的 `ip2region_v4.xdb`，BufferCache 全内存加载，Caffeine 缓存 IP→区域）。`TrackEvent` / `ClickEvent` / `click_event` 表同步加 `region` 列。解析全程 fail-open，任何失败只导致 region 为 null，不阻塞打点。

**Tech Stack:** Java 21、Spring Boot 3.3.13、`org.lionsoul:ip2region:3.3.7`（Maven Central）、Caffeine（已有依赖）、JUnit 5 + Mockito（spring-boot-starter-test 已含）

## Global Constraints

- **不加任何 `app.tracking` 配置项**（用户明确要求）。
- **生产数据库迁移由用户自行执行**：代码侧只更新 DDL 脚本（`scripts/click_event.sql`）与测试 schema（`src/test/resources/schema.sql`），不连库执行。
- 区域格式「省-市」（如 `广东省-深圳市`）；前端传的原样落库（截断 64）；空串视为未传；解析不到为 null。
- **只打包 v4 xdb 数据文件**（约 11MB）；v6 数据文件（约 37MB）不打包，IPv6 查询返回 null。
- xdb 缺失 / 加载失败：fail-open，`resolve()` 返回 null，打点接口不受影响。
- 仓库根目录 `AGENTS.md` 声明「只允许修改前端」——**本轮是用户明确指派的后续打点后端改动**（延续上一轮 `d3002e7` 打点接口），设计已获用户批准，可改 `backend-java/`；但不要顺带改其它无关后端代码。
- 提交遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `test:`），仓库无 commit-msg 钩子，pre-commit 只格式化 `front/` 下文件，不影响后端提交。
- 所有 maven 命令在 `backend-java/` 目录下执行；首次运行会联网下载依赖（ip2region 3.3.7 及传递依赖）。

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `backend-java/pom.xml` | 修改 | 加 `org.lionsoul:ip2region:3.3.7` 依赖 |
| `backend-java/src/main/resources/ip2region/ip2region_v4.xdb` | 新建（二进制 ~11MB） | ip2region v4 离线数据文件 |
| `.gitattributes` | 修改 | 加 `*.xdb binary`，防止 11MB 二进制被 `text=auto` 行尾转换损坏 |
| `backend-java/src/main/java/com/guyu/stock/service/region/RegionResolver.java` | 新建 | 区域解析接口（留在线 API 扩展位） |
| `backend-java/src/main/java/com/guyu/stock/service/region/Ip2RegionResolver.java` | 新建 | 离线 ip2region 实现（@Service，BufferCache + Caffeine 缓存） |
| `backend-java/src/test/java/com/guyu/stock/service/region/Ip2RegionResolverTest.java` | 新建 | Resolver 单测 |
| `backend-java/src/main/java/com/guyu/stock/model/TrackEvent.java` | 修改 | 增加 `region` 组件（客户端入参） |
| `backend-java/src/main/java/com/guyu/stock/model/ClickEvent.java` | 修改 | 增加 `region` 组件（入库行） |
| `backend-java/src/main/java/com/guyu/stock/service/TrackService.java` | 修改 | 注入 RegionResolver，toRow 加优先级逻辑 |
| `backend-java/src/main/java/com/guyu/stock/dao/TrackRepository.java` | 修改 | INSERT 语句加 `region` 列与参数 |
| `backend-java/src/test/java/com/guyu/stock/service/TrackServiceTest.java` | 新建 | region 优先级单测（mock Repository + Resolver） |
| `backend-java/src/test/resources/schema.sql` | 修改 | click_event 表加 `region VARCHAR(64)`（测试库） |
| `backend-java/scripts/click_event.sql` | 修改 | click_event 建表脚本加 region 列与注释（新环境用） |
| `docs/API.md` | 修改 | 「七、用户行为打点」字段表加 region |
| `docs/埋点打点方案.md` | 修改 | 契约示例与合规说明加 region |
| `docs/每日修改记录/2026-08-24.md` | 新建 | 当日接口变更记录（仓库强制约定） |

---

### Task 1: 添加 ip2region 依赖与 v4 xdb 数据文件

**Files:**
- Modify: `backend-java/pom.xml`
- Create: `backend-java/src/main/resources/ip2region/ip2region_v4.xdb`（二进制）
- Modify: `.gitattributes`

**Interfaces:**
- Produces: 无 Java 接口；为 Task 2 提供可编译依赖与 classpath 数据文件（资源路径 `/ip2region/ip2region_v4.xdb`）

- [ ] **Step 1: 在 pom.xml 加依赖**

在 `backend-java/pom.xml` 的 `<dependencies>` 内、`rome` 依赖（`</dependency>` 之后）与 `</dependencies>` 之间插入：

```xml
        <!-- IP 归属地解析：打点接口 region 兜底（离线 ip2region v4 xdb 查询） -->
        <dependency>
            <groupId>org.lionsoul</groupId>
            <artifactId>ip2region</artifactId>
            <version>3.3.7</version>
        </dependency>
```

- [ ] **Step 2: 下载 v4 数据文件到 classpath**

```bash
mkdir -p backend-java/src/main/resources/ip2region
curl -L --fail -o backend-java/src/main/resources/ip2region/ip2region_v4.xdb \
  https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb
ls -lh backend-java/src/main/resources/ip2region/ip2region_v4.xdb
```

Expected: 文件存在，约 11M（`11M` 或 `12M` 级，实际 11,122,092 字节）。
若下载失败（网络/404），改用 tag 版本重试：
`https://raw.githubusercontent.com/lionsoul2014/ip2region/v3.11.1/data/ip2region_v4.xdb`

- [ ] **Step 3: .gitattributes 加二进制规则**

在 `.gitattributes` 末尾追加一行（防止 `* text=auto` 对二进制做行尾转换）：

```
*.xdb binary
```

- [ ] **Step 4: 验证编译通过（联网拉取依赖）**

```bash
cd backend-java && mvn -q -DskipTests compile
```

Expected: 退出码 0，无编译错误（首次会下载 ip2region 3.3.7 及传递依赖，稍慢属正常）。

- [ ] **Step 5: 提交**

```bash
git add backend-java/pom.xml backend-java/src/main/resources/ip2region/ip2region_v4.xdb .gitattributes
git commit -m "feat: 打点接口接入 ip2region 依赖与 v4 数据文件"
```

---

### Task 2: RegionResolver 接口 + Ip2RegionResolver 离线实现

**Files:**
- Create: `backend-java/src/main/java/com/guyu/stock/service/region/RegionResolver.java`
- Create: `backend-java/src/main/java/com/guyu/stock/service/region/Ip2RegionResolver.java`
- Test: `backend-java/src/test/java/com/guyu/stock/service/region/Ip2RegionResolverTest.java`

**Interfaces:**
- Produces: `RegionResolver.resolve(String ip): String`（`省-市` 或 null）；`Ip2RegionResolver` 为 `@Service` Bean，供 Task 3 的 `TrackService` 构造注入。

- [ ] **Step 1: 写 RegionResolver 接口**

创建 `backend-java/src/main/java/com/guyu/stock/service/region/RegionResolver.java`：

```java
package com.guyu.stock.service.region;

/**
 * 用户区域解析（打点接口 region 兜底）。
 *
 * <p>当前实现 {@link Ip2RegionResolver} 走离线 ip2region v4 xdb；未来如需切换
 * 在线 IP 归属 API，新增实现替换 Bean 即可，调用方（TrackService）零改动。
 */
public interface RegionResolver {

    /**
     * 按 IP 解析用户区域，返回「省份-城市」格式（如 {@code 广东省-深圳市}）。
     *
     * @param ip 客户端 IP（IPv4 / IPv6 字符串）
     * @return 区域字符串；解析不到（内网/非法 IP、IPv6 未启用、非中国区域、加载失败）返回 null
     */
    String resolve(String ip);
}
```

- [ ] **Step 2: 写失败测试**

创建 `backend-java/src/test/java/com/guyu/stock/service/region/Ip2RegionResolverTest.java`：

```java
package com.guyu.stock.service.region;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Ip2RegionResolverTest {

    private final Ip2RegionResolver resolver = new Ip2RegionResolver();

    @Test
    void resolveKnownPublicChinaIpReturnsProvinceCity() {
        // 阿里公共 DNS（浙江杭州）：只断言「省-市」格式，不断言具体城市（数据文件会更新）
        String region = resolver.resolve("223.5.5.5");
        assertNotNull(region, "公网中国 IP 应能解析出区域");
        assertTrue(region.contains("-"), "期望「省-市」格式，实际: " + region);
    }

    @Test
    void resolvePrivateIpReturnsNull() {
        assertNull(resolver.resolve("127.0.0.1"));
        assertNull(resolver.resolve("10.0.0.1"));
        assertNull(resolver.resolve("192.168.1.1"));
    }

    @Test
    void resolveInvalidIpReturnsNull() {
        assertNull(resolver.resolve("not-an-ip"));
        assertNull(resolver.resolve("999.999.1.1"));
    }

    @Test
    void resolveBlankOrNullReturnsNull() {
        assertNull(resolver.resolve(""));
        assertNull(resolver.resolve(null));
    }

    @Test
    void resolveIpv6ReturnsNull() {
        // 未打包 v6 xdb，IPv6 查询返回 null
        assertNull(resolver.resolve("240e:3b7:3272:d8d0:db09:c067:8d59:539e"));
    }
}
```

- [ ] **Step 3: 运行测试，确认失败（编译错误）**

```bash
cd backend-java && mvn -q test -Dtest=Ip2RegionResolverTest
```

Expected: 编译失败，报 `cannot find symbol: class Ip2RegionResolver`（红）。

- [ ] **Step 4: 写 Ip2RegionResolver 实现**

创建 `backend-java/src/main/java/com/guyu/stock/service/region/Ip2RegionResolver.java`：

```java
package com.guyu.stock.service.region;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PreDestroy;
import org.lionsoul.ip2region.service.Config;
import org.lionsoul.ip2region.service.Ip2Region;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;

/**
 * 离线 ip2region 区域解析（{@link RegionResolver} 默认实现）。
 *
 * <p>数据文件 {@code ip2region_v4.xdb}（约 11MB）打包在 classpath，启动时经
 * {@code setXdbInputStream} + {@code BufferCache} 全量读入内存（不落临时文件、
 * 查询零磁盘 IO、并发安全）。仅打包 IPv4 数据（v6 文件约 37MB，暂不打包），
 * IPv6 查询返回 null。
 *
 * <p>fail-open：xdb 缺失 / 加载失败时记 ERROR 日志，{@code ip2Region} 置 null，
 * 所有解析返回 null，不影响打点接口主流程。
 *
 * <p>查询结果按 IP 做 Caffeine 缓存（1 万条 / 24h），批量上报同 IP 只查一次。
 */
@Service
public class Ip2RegionResolver implements RegionResolver {

    private static final Logger log = LoggerFactory.getLogger(Ip2RegionResolver.class);

    /** classpath 下的 v4 数据文件 */
    private static final String XDB_RESOURCE = "/ip2region/ip2region_v4.xdb";
    private static final String CN = "中国";
    private static final String ZERO = "0";

    /** 加载失败时为 null（fail-open） */
    private final Ip2Region ip2Region;
    private final Cache<String, String> cache;

    public Ip2RegionResolver() {
        this.ip2Region = load();
        this.cache = Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(Duration.ofHours(24))
                .build();
    }

    @Override
    public String resolve(String ip) {
        if (ip == null || ip.isBlank() || ip2Region == null) {
            return null;
        }
        return cache.get(ip, this::doResolve);
    }

    /** 原始串形如「中国|0|广东省|深圳市|电信」，解析为「省-市」；国家非中国/字段为 0 → null */
    private String doResolve(String ip) {
        try {
            return toProvinceCity(ip2Region.search(ip));
        } catch (Exception e) {
            // 非法 IP / 查询失败：不抛异常，返回 null
            return null;
        }
    }

    private String toProvinceCity(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String[] parts = raw.split("\\|");
        if (parts.length < 5) return null;
        if (!CN.equals(parts[0])) return null;          // 只统计国内用户区域
        String province = parts[2];
        String city = parts[3];
        if (province == null || province.isBlank() || ZERO.equals(province)) return null;
        if (city == null || city.isBlank() || ZERO.equals(city)) return province;
        return province + "-" + city;
    }

    private Ip2Region load() {
        try (var in = Ip2RegionResolver.class.getResourceAsStream(XDB_RESOURCE)) {
            if (in == null) {
                log.error("[region] xdb 资源缺失: {}", XDB_RESOURCE);
                return null;
            }
            Config v4 = Config.custom()
                    .setCachePolicy(Config.BufferCache)
                    .setXdbInputStream(in)
                    .asV4();
            return Ip2Region.create(v4, null);
        } catch (Exception e) {
            log.error("[region] ip2region 初始化失败，区域解析降级为 null（打点接口不受影响）", e);
            return null;
        }
    }

    @PreDestroy
    public void close() {
        if (ip2Region != null) {
            try {
                ip2Region.close();
            } catch (Exception e) {
                log.warn("[region] ip2region 关闭失败", e);
            }
        }
    }
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd backend-java && mvn -q test -Dtest=Ip2RegionResolverTest
```

Expected: BUILD SUCCESS，5 个测试全绿。
若 `resolveKnownPublicChinaIpReturnsProvinceCity` 失败且断言信息显示实际为 null：说明 master 数据文件与 3.3.7 库不兼容，回 Task 1 Step 2 换成 tag v3.11.1 的数据文件后重跑本步。

- [ ] **Step 6: 提交**

```bash
git add backend-java/src/main/java/com/guyu/stock/service/region/ backend-java/src/test/java/com/guyu/stock/service/region/
git commit -m "feat: 新增 RegionResolver 离线 IP 区域解析（ip2region）"
```

---

### Task 3: TrackService / 模型 / Repository 接入 region

**Files:**
- Modify: `backend-java/src/main/java/com/guyu/stock/model/TrackEvent.java`
- Modify: `backend-java/src/main/java/com/guyu/stock/model/ClickEvent.java`
- Modify: `backend-java/src/main/java/com/guyu/stock/service/TrackService.java`
- Modify: `backend-java/src/main/java/com/guyu/stock/dao/TrackRepository.java`
- Test: `backend-java/src/test/java/com/guyu/stock/service/TrackServiceTest.java`

**Interfaces:**
- Consumes: `RegionResolver.resolve(String)`（Task 2 产出）
- Produces: `TrackEvent.region()`（客户端入参，可选）；`ClickEvent.region()`（入库行）；`TrackService(TrackRepository, AppProperties, RegionResolver)` 三参构造。

- [ ] **Step 1: 写失败测试（region 优先级）**

创建 `backend-java/src/test/java/com/guyu/stock/service/TrackServiceTest.java`：

```java
package com.guyu.stock.service;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.TrackRepository;
import com.guyu.stock.model.ClickEvent;
import com.guyu.stock.model.TrackEvent;
import com.guyu.stock.service.region.RegionResolver;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TrackServiceTest {

    private final TrackRepository repository = mock(TrackRepository.class);
    private final AppProperties appProperties = new AppProperties();
    private final RegionResolver resolver = mock(RegionResolver.class);

    private TrackService newService() {
        return new TrackService(repository, appProperties, resolver);
    }

    private TrackEvent event(String region) {
        return new TrackEvent("evt-1", "search.submit", "action", "pages/search/index",
                "600519", null, null, "sess-1", 1724000000123L, "ios", "1.0.0", region);
    }

    private ClickEvent captureSingleRow() {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ClickEvent>> captor = ArgumentCaptor.forClass(List.class);
        verify(repository).batchInsert(captor.capture());
        return captor.getValue().get(0);
    }

    @Test
    void frontendRegionWins() {
        TrackService service = newService();
        service.ingest(List.of(event("上海市-上海市")), null, "1.2.3.4");

        ClickEvent row = captureSingleRow();
        assertEquals("上海市-上海市", row.region());
        verify(resolver, never()).resolve(any());
    }

    @Test
    void backendResolvesWhenFrontendMissing() {
        when(resolver.resolve("1.2.3.4")).thenReturn("广东省-深圳市");
        TrackService service = newService();
        service.ingest(List.of(event(null)), null, "1.2.3.4");

        ClickEvent row = captureSingleRow();
        assertEquals("广东省-深圳市", row.region());
    }

    @Test
    void blankFrontendRegionFallsBackToBackend() {
        when(resolver.resolve("1.2.3.4")).thenReturn("广东省-深圳市");
        TrackService service = newService();
        service.ingest(List.of(event("")), null, "1.2.3.4");

        ClickEvent row = captureSingleRow();
        assertEquals("广东省-深圳市", row.region());
    }

    @Test
    void resolveFailureYieldsNullRegion() {
        when(resolver.resolve("1.2.3.4")).thenReturn(null);
        TrackService service = newService();
        service.ingest(List.of(event(null)), null, "1.2.3.4");

        ClickEvent row = captureSingleRow();
        assertNull(row.region());
    }

    @Test
    void frontendRegionTruncatedTo64() {
        TrackService service = newService();
        String longRegion = "某".repeat(80);
        service.ingest(List.of(event(longRegion)), null, "1.2.3.4");

        ClickEvent row = captureSingleRow();
        assertEquals(64, row.region().length());
    }
}
```

- [ ] **Step 2: 运行测试，确认失败（编译错误）**

```bash
cd backend-java && mvn -q test -Dtest=TrackServiceTest
```

Expected: 编译失败（`TrackEvent` 11 参构造与测试的 12 参不匹配、`ClickEvent.region()` 不存在、`TrackService` 无三参构造）（红）。

- [ ] **Step 3: TrackEvent 加 region 组件**

将 `backend-java/src/main/java/com/guyu/stock/model/TrackEvent.java` 的 record 声明改为（javadoc 的 `<ul>` 列表加一行 region 说明，正文如下）：

```java
public record TrackEvent(
        String eventId,
        String eventName,
        String eventType,
        String page,
        String target,
        Object props,
        Integer durationMs,
        String sessionId,
        Long clientTs,
        String platform,
        String appVersion,
        String region) {}
```

javadoc 中在 `{@code durationMs}` 一行后追加：

```
 *   <li>{@code region}：用户区域（可选），形如「广东省-深圳市」，前端上报优先，
 *       未传时后端按 IP 解析兜底（见 {@code RegionResolver}）；</li>
```

- [ ] **Step 4: ClickEvent 加 region 组件**

将 `backend-java/src/main/java/com/guyu/stock/model/ClickEvent.java` 的 record 末尾追加组件（`appVersion` 之后）：

```java
public record ClickEvent(
        String eventId,
        Long userId,
        String sessionId,
        String eventType,
        String eventName,
        String page,
        String target,
        String props,
        Integer durationMs,
        Long clientTs,
        String ip,
        String platform,
        String appVersion,
        String region) {}
```

javadoc 里 `{@code props} 已序列化为 JSON 字符串` 一段之后补一句：`{@code region} 为用户区域（省-市），前端上报优先，否则由后端按 IP 解析。`

- [ ] **Step 5: TrackService 注入 RegionResolver 并实现优先级**

修改 `backend-java/src/main/java/com/guyu/stock/service/TrackService.java`：

a) 增加 import 与字段：

```java
import com.guyu.stock.service.region.RegionResolver;
```

```java
    private final TrackRepository trackRepository;
    private final AppProperties.Tracking cfg;
    private final RegionResolver regionResolver;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public TrackService(TrackRepository trackRepository, AppProperties appProperties,
                        RegionResolver regionResolver) {
        this.trackRepository = trackRepository;
        this.cfg = appProperties.getTracking();
        this.regionResolver = regionResolver;
    }
```

b) `toRow` 改为（前端 region 非空优先，否则 IP 解析兜底）：

```java
    private ClickEvent toRow(TrackEvent e, Long userId, String ip) {
        String region = (e.region() != null && !e.region().isBlank())
                ? truncate(e.region(), 64)
                : regionResolver.resolve(ip);
        return new ClickEvent(
                truncate(e.eventId(), 64),
                userId,
                truncate(e.sessionId(), 64),
                truncate(e.eventType(), 32),
                truncate(e.eventName(), 128),
                truncate(e.page(), 128),
                truncate(e.target(), 128),
                serializeProps(e.props()),
                clampInt(e.durationMs()),
                e.clientTs(),
                truncate(ip, 64),
                truncate(e.platform(), 32),
                truncate(e.appVersion(), 32),
                region);
    }
```

类 javadoc 的 `<ol>` 流程列表第 3 条（序列化 props）之后补一条：
`<li>区域取值：前端 {@code region} 非空则原样截断落库，否则按 {@code ip} 经 {@code RegionResolver} 解析兜底（解析失败为 null）；</li>`

- [ ] **Step 6: TrackRepository 的 INSERT 加 region 列**

修改 `backend-java/src/main/java/com/guyu/stock/dao/TrackRepository.java` 的 `batchInsert` SQL 与参数：

```java
        for (ClickEvent e : events) {
            inserted += jdbcTemplate.update("""
                    INSERT INTO click_event
                        (event_id, user_id, session_id, event_type, event_name, page, target, props,
                         duration_ms, client_ts, ip, platform, app_version, region)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT (event_id) DO NOTHING
                    """,
                    e.eventId(), e.userId(), e.sessionId(), e.eventType(), e.eventName(),
                    e.page(), e.target(), e.props(), e.durationMs(), e.clientTs(),
                    e.ip(), e.platform(), e.appVersion(), e.region());
        }
```

- [ ] **Step 7: 运行全部测试，确认通过**

```bash
cd backend-java && mvn -q test
```

Expected: BUILD SUCCESS，`Ip2RegionResolverTest`（5 个）+ `TrackServiceTest`（5 个）全绿。

- [ ] **Step 8: 提交**

```bash
git add backend-java/src/main/java/com/guyu/stock/model/TrackEvent.java backend-java/src/main/java/com/guyu/stock/model/ClickEvent.java backend-java/src/main/java/com/guyu/stock/service/TrackService.java backend-java/src/main/java/com/guyu/stock/dao/TrackRepository.java backend-java/src/test/java/com/guyu/stock/service/TrackServiceTest.java
git commit -m "feat: 打点接口支持前端 region 上报并按 IP 兜底解析"
```

---

### Task 4: 同步 DDL 脚本与文档

**Files:**
- Modify: `backend-java/src/test/resources/schema.sql`
- Modify: `backend-java/scripts/click_event.sql`
- Modify: `docs/API.md`
- Modify: `docs/埋点打点方案.md`
- Create: `docs/每日修改记录/2026-08-24.md`

**Interfaces:**
- 无代码接口；同步仓库 DDL 与文档，保证新环境建表、接口文档、变更记录一致。

- [ ] **Step 1: 测试库 schema 加 region 列**

`backend-java/src/test/resources/schema.sql` 的 `click_event` 建表段（当前以 `app_version  VARCHAR(32)` 结尾）改为：

```sql
    ip           VARCHAR(64),
    platform     VARCHAR(32),
    app_version  VARCHAR(32),
    region       VARCHAR(64)
);
```

- [ ] **Step 2: 生产 DDL 脚本加 region 列与注释**

`backend-java/scripts/click_event.sql` 的建表段（当前以 `app_version  VARCHAR(32)` 结尾）改为：

```sql
    platform     VARCHAR(32),                     -- devtools/ios/android
    app_version  VARCHAR(32),
    region       VARCHAR(64)                      -- 用户区域（省-市），前端上报优先，否则按 IP 解析
);
```

并在文件末尾的 `COMMENT ON COLUMN` 段追加：

```sql
COMMENT ON COLUMN click_event.region IS '用户区域（省-市），前端上报优先，否则按 IP 解析';
```

- [ ] **Step 3: docs/API.md 字段表加 region**

`docs/API.md`「七、用户行为打点」7.1 的 `events` 元素字段表（当前最后一行 `| appVersion | ... |`）之后加一行：

```markdown
| region | string | 否 | 用户区域，形如 `广东省-深圳市`；前端未传时后端按客户端 IP 解析兜底（仅 IPv4，IPv6 / 解析失败为 null） |
```

同时把请求体示例 JSON（`"appVersion": "1.2.3"` 之后）加一行：

```json
      "region": "广东省-深圳市",
```

- [ ] **Step 4: docs/埋点打点方案.md 契约与合规说明**

a) 第三节请求体示例（`"appVersion": "1.2.3"` 之后）加一行：

```json
      "region": "广东省-深圳市",
```

b) 第五节「合规与性能注意」追加一条：

```markdown
6. `region` 仅上报省/市粒度（如「广东省-深圳市」），不报精确位置；前端可不上报，后端按 IP 兜底解析。
```

- [ ] **Step 5: 新建每日修改记录**

创建 `docs/每日修改记录/2026-08-24.md`：

```markdown
# 接口修改记录 · 2026-08-24

> 说明：本文件只记录**对外 HTTP 接口**（`/api/v1/**` controller 层契约）的变更；
> 内部实现文件仅列在「关联文件」，不影响接口契约的内部重构归入「备注」。

## 一、新增接口

（无）

## 二、修改接口

### POST /api/v1/track/events（修改：事件元素新增可选入参 region）

- **用途**：不变（用户行为打点批量上报）。
- **变更**：`events` 数组元素新增可选字段 `region`（string，形如 `广东省-深圳市`）。
  前端传了原样落库（截断 64）；未传或空串时后端按客户端 IP 离线解析归属地（省-市）兜底；
  解析不到（内网 / 非法 IP / IPv6 / 非中国区域 / 数据加载失败）为 null。
- **入参**（JSON body）变更行：

  | 参数 | 类型 | 必填 | 说明 |
  |---|---|---|---|
  | region | string | 否 | 用户区域，形如 `广东省-深圳市`；前端优先，未传按 IP 解析兜底 |

- **出参**：不变。
- **关联文件**：`service/TrackService.java`、`service/region/RegionResolver.java`（新增）、
  `service/region/Ip2RegionResolver.java`（新增）、`dao/TrackRepository.java`、
  `model/TrackEvent.java`、`model/ClickEvent.java`、`pom.xml`、
  `src/main/resources/ip2region/ip2region_v4.xdb`（新增，v4 数据文件）、
  `scripts/click_event.sql`、`src/test/resources/schema.sql`

## 三、备注

- `click_event` 表新增 `region VARCHAR(64)` 列；**生产库需先执行（用户自行执行）**：

  ```sql
  ALTER TABLE click_event ADD COLUMN IF NOT EXISTS region VARCHAR(64);
  COMMENT ON COLUMN click_event.region IS '用户区域（省-市），前端上报优先，否则按 IP 解析';
  ```

- 兜底解析用离线 ip2region（`org.lionsoul:ip2region:3.3.7`）+ 打包 `ip2region_v4.xdb`
  （约 11MB，BufferCache 全内存加载）；**仅打包 IPv4 数据，IPv6 查询返回 null**
  （v6 数据文件约 37MB，暂不打包）。
- 解析为 fail-open：xdb 缺失 / 加载失败记 ERROR 日志，region 一律为 null，打点接口不受影响。
- 前端埋点 SDK（`front/utils/tracker.ts`）由他人实现，按新契约可选上报 `region` 即可。
```

- [ ] **Step 6: 提交**

```bash
git add backend-java/src/test/resources/schema.sql backend-java/scripts/click_event.sql docs/API.md docs/埋点打点方案.md docs/每日修改记录/2026-08-24.md
git commit -m "docs: 打点接口 region 字段 DDL 与文档同步"
```

---

## 验证清单（全部完成后）

1. `cd backend-java && mvn -q test` → BUILD SUCCESS（10 个测试全绿）。
2. `git log --oneline -5` 可见 4 个新提交（Task 1-4）。
3. 生产发布前提醒用户执行：`ALTER TABLE click_event ADD COLUMN IF NOT EXISTS region VARCHAR(64);`
