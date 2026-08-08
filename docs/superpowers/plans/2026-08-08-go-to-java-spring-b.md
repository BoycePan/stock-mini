# Go → Java Spring 迁移（B 阶段）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `backend-java/` 新建 Spring Boot 工程，实现 7 个核心接口（health / auth-login / user-profile / stock-search / stock-klines / stock-quote / stock-quotes），与 Go 版 `backend/` 并存，响应契约逐字对齐，前端零改动。

**Architecture:** 分层的 Spring Boot 单体：`@RestController`(controller) → `@Service`(service) → JdbcTemplate repository，外加 `external/sina` 新浪实时行情客户端（RestClient + Guava RateLimiter + GBK 解码 + Caffeine 缓存）。统一响应 `ApiResponse{code,msg,data}` + `@RestControllerAdvice` 全局异常。JWT 用 jjwt HS256 复用 Go 版同一 secret。

**Tech Stack:** Java 21、Maven、Spring Boot 3.3.x、Spring JDBC (JdbcTemplate)、jjwt 0.12.x、Guava、Caffeine、Lombok、PostgreSQL 驱动、H2 (测试)。

## Global Constraints

- **API 契约与 Go 版逐字一致**：路径、HTTP 状态码（除 health 外恒 200）、body 字段名。前端 `request.ts` 只认 `{code:200, msg, data}`。
- **`/api/health` 不走 R 包装**：直接返回 `{"status":"ok","database":"connected"}`（HTTP 200）。
- **JWT**：HS256，密钥用 `new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")`，与 Go `[]byte(secret)` 完全一致。**secret 通过环境变量 `JWT_SECRET` 注入，plan 中不出现真实值**。
- **数据库**：直连现网 PostgreSQL `gu_yu_stock`（B 阶段只读，除 login 写 users 表）。**密码通过环境变量 `DB_PASSWORD` 注入**，plan 中不出现真实值。单测用 H2 内存库，不连现网。
- **K 线**：`scale` 映射 `240→1d`、`1200→1w`；库内按 `trade_date DESC` 查询，API 返回**升序**（倒序遍历反转）。B 阶段 DB 未命中直接返回空数组，不做新浪回退。
- **新浪行情**：限流 1 次/秒（Guava RateLimiter），Caffeine 缓存 TTL 3 秒，响应为 GBK 需转 UTF-8。
- **错误码**：`200/400/401/403/404/500/1001/1002/1003`，消息文案与 Go `errcode.go` 一致。
- **提交规范**：每步一个 commit，message 用 `feat:/fix:/test:/docs:` 前缀。
- **包名**：`com.guyu.stock`。测试代码放 `src/test/java/com/guyu/stock/...`。
- **生产配置保密**：任何现网密钥（JWT secret、DB 密码、微信 appid/secret）不得写入源码或 plan，一律环境变量注入。

---

## File Structure

**创建的文件（backend-java/ 下）：**

| 文件 | 职责 |
|---|---|
| `pom.xml` | 工程与依赖 |
| `src/main/resources/application.yml` | 公共配置（占位符引用环境变量） |
| `src/main/resources/application-dev.yml` | 开发环境覆盖 |
| `src/main/java/com/guyu/stock/StockApplication.java` | 启动类 |
| `src/main/java/com/guyu/stock/common/ApiResponse.java` | `{code,msg,data}` 统一响应 |
| `src/main/java/com/guyu/stock/common/BizException.java` | 业务异常（对应 Go `BizError`） |
| `src/main/java/com/guyu/stock/common/ErrCode.java` | 错误码常量 + 消息 |
| `src/main/java/com/guyu/stock/common/GlobalExceptionHandler.java` | `@RestControllerAdvice`（对应 Go `Recovery`） |
| `src/main/java/com/guyu/stock/config/AppProperties.java` | `app.*` 配置绑定 |
| `src/main/java/com/guyu/stock/config/WebConfig.java` | 注册 AuthInterceptor |
| `src/main/java/com/guyu/stock/auth/AuthInterceptor.java` | Bearer token 校验（对应 Go `middleware/jwt.go`） |
| `src/main/java/com/guyu/stock/auth/JwtService.java` | jjwt 签发/校验 |
| `src/main/java/com/guyu/stock/auth/WechatService.java` | 微信 code2Session |
| `src/main/java/com/guyu/stock/auth/AuthController.java` | `POST /api/v1/auth/login` |
| `src/main/java/com/guyu/stock/auth/UserController.java` | `GET /api/v1/user/profile` |
| `src/main/java/com/guyu/stock/user/UserRepository.java` | users 表 CRUD（JdbcTemplate） |
| `src/main/java/com/guyu/stock/stock/StockInfoRepository.java` | stock_info 表查询 |
| `src/main/java/com/guyu/stock/stock/StockKlineRepository.java` | stock_kline 表查询 |
| `src/main/java/com/guyu/stock/stock/StockService.java` | K 线/搜索业务 + scale 映射 |
| `src/main/java/com/guyu/stock/stock/StockController.java` | search / klines / quote / quotes |
| `src/main/java/com/guyu/stock/external/sina/Quote.java` | 行情 POJO（JSON 字段名对齐 Go） |
| `src/main/java/com/guyu/stock/external/sina/SinaClient.java` | HTTP + 限流 + GBK 解码 + 解析 |
| `src/main/java/com/guyu/stock/external/sina/SinaQuoteService.java` | Caffeine 缓存 + 调 SinaClient |
| `src/test/java/...` | 各任务对应测试 |

**SQL 映射（照抄 Go）：**
- `StockKlineRepository.queryByCode`: `SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT ?`
- `StockInfoRepository.search`: 见 Task 4（带 `CASE WHEN` 排序的 4 条件模糊查询）
- `UserRepository.findByOpenId`: `SELECT * FROM users WHERE openid = ?`
- `UserRepository.create`: `INSERT INTO users (openid, unionid, session_key, status, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id`
- `UserRepository.updateLogin`: `UPDATE users SET session_key = ?, unionid = COALESCE(?, unionid), last_login_at = ?, updated_at = ? WHERE id = ?`

---

### Task 1: 工程骨架 + 健康检查

**Files:**
- Create: `backend-java/pom.xml`
- Create: `backend-java/src/main/resources/application.yml`
- Create: `backend-java/src/main/resources/application-dev.yml`
- Create: `backend-java/src/main/java/com/guyu/stock/StockApplication.java`
- Create: `backend-java/src/main/java/com/guyu/stock/config/AppProperties.java`
- Create: `backend-java/src/main/java/com/guyu/stock/health/HealthController.java`
- Test: `backend-java/src/test/java/com/guyu/stock/health/HealthControllerTest.java`

**Interfaces:**
- Produces: `HealthController` 暴露 `GET /api/health` → `Map<String,String>`（`{"status":"ok","database":"connected"}`）
- Produces: `AppProperties` 含 `jwt()` / `wechat()` / `sina()` 访问器，后续任务消费

- [ ] **Step 1: 写失败测试**

`HealthControllerTest.java`（`@SpringBootTest` + MockMvc，`@ActiveProfiles("test")` 走 H2）：

```java
package com.guyu.stock.health;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthReturnsOkAndConnected() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.database").value("connected"));
    }
}
```

`src/test/resources/application-test.yml`：

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:health;MODE=PostgreSQL;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password:
```

- [ ] **Step 2: 运行验证失败**

Run: `cd backend-java && mvn test -Dtest=HealthControllerTest`
Expected: FAIL（编译失败 / 无类，因为工程还没建）

- [ ] **Step 3: 写工程骨架 + 实现**

`pom.xml`（完整）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.13</version>
        <relativePath/>
    </parent>

    <groupId>com.guyu</groupId>
    <artifactId>stock-backend</artifactId>
    <version>0.1.0</version>
    <name>stock-backend</name>
    <description>wx-app-stock Java Spring Boot backend</description>

    <properties>
        <java.version>21</java.version>
        <jjwt.version>0.12.6</jjwt.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-jdbc</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- JWT -->
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-api</artifactId>
            <version>${jjwt.version}</version>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-impl</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-jackson</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>

        <!-- 限流 -->
        <dependency>
            <groupId>com.google.guava</groupId>
            <artifactId>guava</artifactId>
            <version>33.3.1-jre</version>
        </dependency>

        <!-- 缓存 -->
        <dependency>
            <groupId>com.github.ben-manes.caffeine</groupId>
            <artifactId>caffeine</artifactId>
        </dependency>

        <!-- Lombok -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- 测试 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

`application.yml`（全部敏感值用环境变量占位，plan 不写真实值；运行前从 Go 版 `backend/config.yaml` 或部署环境获取并导出为环境变量）：

```yaml
server:
  port: 18487

spring:
  application:
    name: stock-backend
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 25
      minimum-idle: 5

app:
  jwt:
    secret: ${JWT_SECRET}
    expire-hours: ${JWT_EXPIRE_HOURS:24}
  wechat:
    app-id: ${WECHAT_APP_ID}
    app-secret: ${WECHAT_APP_SECRET}
  sina:
    rate-limit-seconds: 1.0
    max-retries: 3
    timeout-seconds: 30
    user-agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    referer: "https://finance.sina.com.cn"
```

`application-dev.yml`（开发 profile：值从环境变量或命令行覆盖注入，不硬编码）：

```yaml
spring:
  datasource:
    username: ${DB_USER}
    password: ${DB_PASSWORD}
```

`StockApplication.java`:

```java
package com.guyu.stock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class StockApplication {
    public static void main(String[] args) {
        SpringApplication.run(StockApplication.class, args);
    }
}
```

`AppProperties.java`:

```java
package com.guyu.stock.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private Jwt jwt = new Jwt();
    private Wechat wechat = new Wechat();
    private Sina sina = new Sina();

    @Data
    public static class Jwt {
        private String secret;
        private int expireHours;
    }

    @Data
    public static class Wechat {
        private String appId;
        private String appSecret;
    }

    @Data
    public static class Sina {
        private double rateLimitSeconds;
        private int maxRetries;
        private int timeoutSeconds;
        private String userAgent;
        private String referer;
    }
}
```

`HealthController.java`（对齐 Go `healthHandler`：DB ping，返回 `{status, database}`，不走 R 包装）：

```java
package com.guyu.stock.health;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/api/health")
    public Map<String, String> health() {
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return Map.of("status", "ok", "database", "connected");
        } catch (Exception e) {
            return Map.of("status", "degraded", "database", "disconnected: " + e.getMessage());
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend-java && mvn test -Dtest=HealthControllerTest`
Expected: PASS（`/api/health` 返回 `{"status":"ok","database":"connected"}`）

- [ ] **Step 5: 提交**

```bash
git add backend-java
git commit -m "feat: scaffold Spring Boot project with health check endpoint"
```

---

### Task 2: 统一响应 + 错误码 + 全局异常处理

**Files:**
- Create: `src/main/java/com/guyu/stock/common/ApiResponse.java`
- Create: `src/main/java/com/guyu/stock/common/BizException.java`
- Create: `src/main/java/com/guyu/stock/common/ErrCode.java`
- Create: `src/main/java/com/guyu/stock/common/GlobalExceptionHandler.java`
- Test: `src/test/java/com/guyu/stock/common/GlobalExceptionHandlerTest.java`

**Interfaces:**
- Consumes: 无（纯 common）
- Produces:
  - `ApiResponse<T>.success(T data)` → `ApiResponse<T>`（code=200, msg="success"）
  - `ApiResponse<T>.error(int code, String msg)` → `ApiResponse<T>`
  - `BizException(int code, String msg)` 可抛出
  - `ErrCode` 常量：`SUCCESS=200, SERVER_ERROR=500, INVALID_PARAM=400, UNAUTHORIZED=401, FORBIDDEN=403, NOT_FOUND=404, TOKEN_INVALID=1001, TOKEN_MISSING=1002, WX_LOGIN_FAIL=1003`
  - 全局异常处理器把 `BizException` → `{code,msg}`（HTTP 200），未知异常 → `{code:500,msg:"server error"}`（HTTP 200）

- [ ] **Step 1: 写失败测试**

```java
package com.guyu.stock.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void bizExceptionMapsToErrorBody() {
        ResponseEntity<ApiResponse<Void>> resp = handler.handleBiz(new BizException(ErrCode.WX_LOGIN_FAIL, "微信登录失败"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().code()).isEqualTo(1003);
        assertThat(resp.getBody().msg()).isEqualTo("微信登录失败");
    }

    @Test
    void unknownExceptionMapsTo500() {
        ResponseEntity<ApiResponse<Void>> resp = handler.handleUnknown(new IllegalStateException("boom"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().code()).isEqualTo(500);
        assertThat(resp.getBody().msg()).isEqualTo("server error");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn test -Dtest=GlobalExceptionHandlerTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`ErrCode.java`:

```java
package com.guyu.stock.common;

import java.util.Map;

public final class ErrCode {
    public static final int SUCCESS = 200;
    public static final int SERVER_ERROR = 500;
    public static final int INVALID_PARAM = 400;
    public static final int UNAUTHORIZED = 401;
    public static final int FORBIDDEN = 403;
    public static final int NOT_FOUND = 404;

    public static final int TOKEN_INVALID = 1001;
    public static final int TOKEN_MISSING = 1002;
    public static final int WX_LOGIN_FAIL = 1003;

    private static final Map<Integer, String> MESSAGES = Map.ofEntries(
            Map.entry(SUCCESS, "success"),
            Map.entry(SERVER_ERROR, "server error"),
            Map.entry(INVALID_PARAM, "param error"),
            Map.entry(UNAUTHORIZED, "unauthorized"),
            Map.entry(FORBIDDEN, "forbidden"),
            Map.entry(NOT_FOUND, "not found"),
            Map.entry(TOKEN_INVALID, "token 无效或已过期"),
            Map.entry(TOKEN_MISSING, "缺少 token"),
            Map.entry(WX_LOGIN_FAIL, "微信登录失败")
    );

    private ErrCode() {}

    public static String msg(int code) {
        return MESSAGES.getOrDefault(code, "unknown error");
    }
}
```

`ApiResponse.java`:

```java
package com.guyu.stock.common;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(int code, String msg, T data) {

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(ErrCode.SUCCESS, ErrCode.msg(ErrCode.SUCCESS), data);
    }

    public static ApiResponse<Void> ok() {
        return new ApiResponse<>(ErrCode.SUCCESS, ErrCode.msg(ErrCode.SUCCESS), null);
    }

    public static <T> ApiResponse<T> error(int code, String msg) {
        String m = (msg == null || msg.isBlank()) ? ErrCode.msg(code) : msg;
        return new ApiResponse<>(code, m, null);
    }
}
```

`BizException.java`:

```java
package com.guyu.stock.common;

public class BizException extends RuntimeException {
    private final int code;

    public BizException(int code, String msg) {
        super(msg);
        this.code = code;
    }

    public int getCode() {
        return code;
    }
}
```

`GlobalExceptionHandler.java`:

```java
package com.guyu.stock.common;

import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.ResponseEntity;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        // 对齐 Go：HTTP 恒 200，业务码在 body
        return ResponseEntity.ok(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception e) {
        // 对齐 Go Recovery 兜底
        return ResponseEntity.ok(ApiResponse.error(ErrCode.SERVER_ERROR, ErrCode.msg(ErrCode.SERVER_ERROR)));
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn test -Dtest=GlobalExceptionHandlerTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/common src/test/java/com/guyu/stock/common
git commit -m "feat: add unified ApiResponse, ErrCode and global exception handler"
```

---

### Task 3: 数据库访问 — K 线查询 + Repository 基础设施

**Files:**
- Create: `src/main/java/com/guyu/stock/stock/StockKline.java`（POJO）
- Create: `src/main/java/com/guyu/stock/stock/StockKlineRepository.java`
- Test: `src/test/resources/schema-test.sql`
- Test: `src/test/java/com/guyu/stock/stock/StockKlineRepositoryTest.java`

**Interfaces:**
- Consumes: `spring-boot-starter-jdbc`、H2（测试）
- Produces:
  - `record StockKline(String code, String scale, LocalDate tradeDate, double open, double high, double low, double close, long volume, double amount, double turnover, double pctChange, double changeAmt, double amplitude)`
  - `List<StockKline> StockKlineRepository.queryByCode(String code, String scale, int limit)`（SQL：`SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT ?`）
  - `LocalDate StockKlineRepository.getLatestDate(String code, String scale)`（无数据返回 null）

- [ ] **Step 1: 写失败测试**

`schema-test.sql`（H2 建表，PostgreSQL 兼容模式；仅 B 阶段需要的列）：

```sql
CREATE TABLE IF NOT EXISTS stock_kline (
    code       VARCHAR(10)  NOT NULL,
    scale      VARCHAR(10)  NOT NULL,
    trade_date DATE         NOT NULL,
    open       DOUBLE PRECISION,
    high       DOUBLE PRECISION,
    low        DOUBLE PRECISION,
    close      DOUBLE PRECISION,
    volume     BIGINT,
    amount     DOUBLE PRECISION,
    turnover   DOUBLE PRECISION,
    pct_change DOUBLE PRECISION,
    change_amt DOUBLE PRECISION,
    amplitude  DOUBLE PRECISION,
    created_at TIMESTAMP,
    PRIMARY KEY (code, scale, trade_date)
);
```

`StockKlineRepositoryTest.java`（`@JdbcTest` 自动加载 `schema-test.sql` 于 `src/test/resources/schema.sql`；若用 `@JdbcTest` 默认找 `schema.sql`，本计划将文件命名为 `src/test/resources/schema.sql`）：

```java
package com.guyu.stock.stock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@JdbcTest
@ActiveProfiles("test")
class StockKlineRepositoryTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private StockKlineRepository repo;

    @BeforeEach
    void setUp() {
        repo = new StockKlineRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM stock_kline");
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600001", "1d", LocalDate.of(2026, 8, 5), 10.0, 11.0, 9.5, 10.5, 1000L, 10000.0);
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600001", "1d", LocalDate.of(2026, 8, 6), 10.5, 12.0, 10.0, 11.5, 2000L, 20000.0);
    }

    @Test
    void queryByCodeReturnsDescOrder() {
        List<StockKline> rows = repo.queryByCode("600001", "1d", 10);
        assertThat(rows).hasSize(2);
        // repo 查询按 trade_date DESC（最新在前），由 service 反转成升序
        assertThat(rows.get(0).tradeDate()).isEqualTo(LocalDate.of(2026, 8, 6));
    }

    @Test
    void getLatestDateReturnsMostRecent() {
        LocalDate d = repo.getLatestDate("600001", "1d");
        assertThat(d).isEqualTo(LocalDate.of(2026, 8, 6));
    }

    @Test
    void getLatestDateReturnsNullWhenEmpty() {
        assertThat(repo.getLatestDate("000001", "1d")).isNull();
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn test -Dtest=StockKlineRepositoryTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`StockKline.java`:

```java
package com.guyu.stock.stock;

import java.time.LocalDate;

public record StockKline(
        String code,
        String scale,
        LocalDate tradeDate,
        double open,
        double high,
        double low,
        double close,
        long volume,
        double amount,
        double turnover,
        double pctChange,
        double changeAmt,
        double amplitude
) {}
```

`StockKlineRepository.java`:

```java
package com.guyu.stock.stock;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class StockKlineRepository {

    private final JdbcTemplate jdbcTemplate;

    public StockKlineRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<StockKline> MAPPER = (rs, i) -> new StockKline(
            rs.getString("code"),
            rs.getString("scale"),
            rs.getDate("trade_date").toLocalDate(),
            rs.getDouble("open"),
            rs.getDouble("high"),
            rs.getDouble("low"),
            rs.getDouble("close"),
            rs.getLong("volume"),
            rs.getDouble("amount"),
            rs.getDouble("turnover"),
            rs.getDouble("pct_change"),
            rs.getDouble("change_amt"),
            rs.getDouble("amplitude")
    );

    public List<StockKline> queryByCode(String code, String scale, int limit) {
        return jdbcTemplate.query(
                "SELECT * FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT ?",
                MAPPER, code, scale, limit);
    }

    public LocalDate getLatestDate(String code, String scale) {
        List<LocalDate> dates = jdbcTemplate.query(
                "SELECT trade_date FROM stock_kline WHERE code=? AND scale=? ORDER BY trade_date DESC LIMIT 1",
                (rs, i) -> rs.getDate(1).toLocalDate(), code, scale);
        return dates.isEmpty() ? null : dates.get(0);
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn test -Dtest=StockKlineRepositoryTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/stock/StockKline.java src/main/java/com/guyu/stock/stock/StockKlineRepository.java src/test
git commit -m "feat: add stock_kline repository with JdbcTemplate"
```

---

### Task 4: K 线接口 + 搜索接口

**Files:**
- Create: `src/main/java/com/guyu/stock/stock/StockInfo.java`（POJO）
- Create: `src/main/java/com/guyu/stock/stock/StockInfoRepository.java`
- Create: `src/main/java/com/guyu/stock/stock/StockService.java`
- Create: `src/main/java/com/guyu/stock/stock/StockController.java`
- Modify: `src/test/resources/schema.sql`（追加 stock_info 表）
- Test: `src/test/java/com/guyu/stock/stock/StockControllerTest.java`（MockMvc + H2）

**Interfaces:**
- Consumes: `StockKlineRepository.queryByCode`（Task 3）、`StockInfoRepository.search`（本任务）
- Produces:
  - `record StockInfo(String code, String name, String type, String market, String board, String industry, boolean isActive, LocalDateTime updatedAt)`
  - `List<StockInfo> StockInfoRepository.search(String keyword, int limit)`（SQL 见下）
  - `StockService.getKlines(String code, String scale, int count)` → `Map<String,Object>`（`{code, scale, klines:[{time,open,high,low,close,volume}], count}`，**升序**）
  - `StockService.search(String q, int limit)` → `Map<String,Object>`（`{keyword, count, stocks}`）
  - `StockController`：`GET /api/v1/stock/search`、`GET /api/v1/stock/:code/klines`

- [ ] **Step 1: 写失败测试**

`schema.sql` 追加 stock_info 建表：

```sql
CREATE TABLE IF NOT EXISTS stock_info (
    code       VARCHAR(10)  PRIMARY KEY,
    name       VARCHAR(64),
    type       VARCHAR(10),
    market     VARCHAR(10),
    board      VARCHAR(10),
    industry   VARCHAR(64),
    is_active  BOOLEAN,
    updated_at TIMESTAMP
);
```

`StockControllerTest.java`:

```java
package com.guyu.stock.stock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StockControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        jdbcTemplate.execute("DELETE FROM stock_kline");
        jdbcTemplate.execute("DELETE FROM stock_info");
        jdbcTemplate.update("INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                "600519", "贵州茅台", "stock", "sh", "main", "白酒", true, java.sql.Timestamp.valueOf("2026-08-07 10:00:00"));
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600519", "1d", LocalDate.of(2026, 8, 6), 1700.0, 1720.0, 1690.0, 1710.0, 10000L, 17000000.0);
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600519", "1d", LocalDate.of(2026, 8, 7), 1710.0, 1730.0, 1700.0, 1725.0, 12000L, 20000000.0);
    }

    @Test
    void klinesReturnsAscendingAndShapeMatchesGo() throws Exception {
        mockMvc.perform(get("/api/v1/stock/600519/klines").param("scale", "240").param("count", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.code").value("600519"))
                .andExpect(jsonPath("$.data.scale").value("240"))
                .andExpect(jsonPath("$.data.count").value(2))
                .andExpect(jsonPath("$.data.klines[0].time").value("2026-08-06"))
                .andExpect(jsonPath("$.data.klines[1].time").value("2026-08-07"))
                .andExpect(jsonPath("$.data.klines[0].open").value(1700.0))
                .andExpect(jsonPath("$.data.klines[0].volume").value(10000));
    }

    @Test
    void searchReturnsKeywordCountAndStocks() throws Exception {
        mockMvc.perform(get("/api/v1/stock/search").param("q", "茅台"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.keyword").value("茅台"))
                .andExpect(jsonPath("$.data.count").value(1))
                .andExpect(jsonPath("$.data.stocks[0].code").value("600519"))
                .andExpect(jsonPath("$.data.stocks[0].name").value("贵州茅台"));
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn test -Dtest=StockControllerTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`StockInfo.java`:

```java
package com.guyu.stock.stock;

import java.time.LocalDateTime;

public record StockInfo(
        String code,
        String name,
        String type,
        String market,
        String board,
        String industry,
        boolean isActive,
        LocalDateTime updatedAt
) {}
```

`StockInfoRepository.java`（SQL 照抄 Go `Search`，含排序优先级）：

```java
package com.guyu.stock.stock;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class StockInfoRepository {

    private final JdbcTemplate jdbcTemplate;

    public StockInfoRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<StockInfo> MAPPER = (rs, i) -> new StockInfo(
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("type"),
            rs.getString("market"),
            rs.getString("board"),
            rs.getString("industry"),
            rs.getBoolean("is_active"),
            rs.getTimestamp("updated_at") != null ? rs.getTimestamp("updated_at").toLocalDateTime() : null
    );

    public List<StockInfo> search(String keyword, int limit) {
        if (limit <= 0) limit = 20;
        return jdbcTemplate.query("""
                SELECT * FROM stock_info
                WHERE is_active = true
                  AND (code = ? OR code LIKE ? OR name LIKE ? OR name LIKE ?)
                ORDER BY
                    CASE
                        WHEN code = ? THEN 1
                        WHEN name LIKE ? THEN 2
                        WHEN code LIKE ? THEN 3
                        ELSE 4
                    END,
                    code
                LIMIT ?
                """, MAPPER,
                keyword, keyword + "%", keyword + "%", "%" + keyword + "%",
                keyword, keyword + "%", keyword + "%", limit);
    }
}
```

`StockService.java`:

```java
package com.guyu.stock.stock;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class StockService {

    private final StockKlineRepository klineRepository;
    private final StockInfoRepository infoRepository;

    public StockService(StockKlineRepository klineRepository, StockInfoRepository infoRepository) {
        this.klineRepository = klineRepository;
        this.infoRepository = infoRepository;
    }

    /** 对齐 Go scaleToDB */
    static String scaleToDb(String scale) {
        return switch (scale) {
            case "240" -> "1d";
            case "1200" -> "1w";
            default -> scale;
        };
    }

    /** 对齐 Go isDBKLine */
    static boolean isDbKline(String scale) {
        return "240".equals(scale) || "1200".equals(scale);
    }

    /** 对齐 Go dbKlinesToResult：库内 DESC → API 升序；返回 {code, scale, klines, count} */
    public Map<String, Object> getKlines(String code, String scale, int count) {
        if (count <= 0) count = 100;
        String dbScale = scaleToDb(scale);

        List<Map<String, Object>> klines = new ArrayList<>();
        List<StockKline> rows = klineRepository.queryByCode(code, dbScale, count);
        // 查询结果 trade_date DESC，反转成升序
        for (int i = rows.size() - 1; i >= 0; i--) {
            StockKline k = rows.get(i);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("time", k.tradeDate().toString());          // "2026-08-06"
            item.put("open", k.open());
            item.put("high", k.high());
            item.put("low", k.low());
            item.put("close", k.close());
            item.put("volume", k.volume());
            klines.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("scale", scale);
        result.put("klines", klines);
        result.put("count", klines.size());
        return result;
    }

    /** 对齐 Go Search handler：返回 {keyword, count, stocks} */
    public Map<String, Object> search(String q, int limit) {
        if (limit <= 0 || limit > 100) limit = 20;
        List<StockInfo> infos = infoRepository.search(q, limit);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("keyword", q);
        result.put("count", infos.size());
        result.put("stocks", infos);
        return result;
    }
}
```

`StockController.java`:

```java
package com.guyu.stock.stock;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/stock")
public class StockController {

    private final StockService stockService;

    public StockController(StockService stockService) {
        this.stockService = stockService;
    }

    @GetMapping("/search")
    public ApiResponse<Map<String, Object>> search(@RequestParam("q") String q,
                                                   @RequestParam(value = "limit", defaultValue = "20") int limit) {
        if (q == null || q.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "q 参数必填");
        }
        return ApiResponse.success(stockService.search(q, limit));
    }

    @GetMapping("/{code}/klines")
    public ApiResponse<Map<String, Object>> getKlines(@PathVariable("code") String code,
                                                      @RequestParam("scale") String scale,
                                                      @RequestParam(value = "count", defaultValue = "100") int count) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
        }
        if (scale == null || scale.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "scale 参数必填，例如 ?scale=240");
        }
        // B 阶段：仅处理 DB 周期；分钟级/新浪回退放 C 阶段
        if (!StockService.isDbKline(scale)) {
            throw new BizException(ErrCode.INVALID_PARAM, "本阶段仅支持日线(scale=240)与周线(scale=1200)");
        }
        return ApiResponse.success(stockService.getKlines(code, scale, count));
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn test -Dtest=StockControllerTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/stock/StockInfo.java src/main/java/com/guyu/stock/stock/StockInfoRepository.java src/main/java/com/guyu/stock/stock/StockService.java src/main/java/com/guyu/stock/stock/StockController.java src/test/java/com/guyu/stock/stock/StockControllerTest.java src/test/resources/schema.sql
git commit -m "feat: add stock klines and search endpoints"
```

---

### Task 5: JWT + 微信登录 + 认证中间件

**Files:**
- Create: `src/main/java/com/guyu/stock/user/User.java`
- Create: `src/main/java/com/guyu/stock/user/UserRepository.java`
- Create: `src/main/java/com/guyu/stock/auth/JwtService.java`
- Create: `src/main/java/com/guyu/stock/auth/WechatService.java`
- Create: `src/main/java/com/guyu/stock/auth/AuthInterceptor.java`
- Create: `src/main/java/com/guyu/stock/auth/AuthController.java`
- Create: `src/main/java/com/guyu/stock/auth/UserController.java`
- Create: `src/main/java/com/guyu/stock/config/WebConfig.java`
- Modify: `src/test/resources/schema.sql`（追加 users 表）
- Test: `src/test/java/com/guyu/stock/auth/JwtServiceTest.java`
- Test: `src/test/java/com/guyu/stock/auth/AuthInterceptorTest.java`

**Interfaces:**
- Consumes: `AppProperties`（Task 1）、`ErrCode`/`BizException`（Task 2）
- Produces:
  - `record User(long id, String openid, String unionid, String sessionKey, String nickname, String avatarUrl, String phoneEnc, int status, LocalDateTime lastLoginAt, LocalDateTime createdAt, LocalDateTime updatedAt)`
  - `String JwtService.generateToken(long userId, String openid)` → HS256 JWT
  - `JwtService.JwtClaims JwtService.parseToken(String token)`（`long userId()` + `String openid()`），无效抛 `BizException(TOKEN_INVALID)`
  - `User UserRepository.findByOpenId(String openid)`（null 若无）
  - `User UserRepository.create(User user)`（回填 id）
  - `void UserRepository.updateLogin(User user)`
  - `Map<String,Object> WechatService.code2Session(String code)` → `{openid, session_key, unionid}`，失败抛 `BizException(WX_LOGIN_FAIL)`
  - `AuthController`：`POST /api/v1/auth/login` body `{"code":"..."}` → `{token, expires_in, user}`（user 字段对齐 Go model，openid 等不外泄）
  - `UserController`：`GET /api/v1/user/profile`（经 interceptor）→ `{user_id}`

- [ ] **Step 1: 写失败测试**

`schema.sql` 追加 users 建表：

```sql
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    openid        VARCHAR(64) UNIQUE,
    unionid       VARCHAR(64),
    session_key   VARCHAR(128),
    nickname      VARCHAR(64),
    avatar_url    VARCHAR(512),
    phone_enc     VARCHAR(128),
    status        INT DEFAULT 1,
    last_login_at TIMESTAMP,
    created_at    TIMESTAMP,
    updated_at    TIMESTAMP
);
```

`JwtServiceTest.java`（测试专用密钥，非生产值）：

```java
package com.guyu.stock.auth;

import com.guyu.stock.common.BizException;
import com.guyu.stock.config.AppProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    // 测试专用密钥（>=32 字节），非生产值
    private static final String TEST_SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private final JwtService jwtService = new JwtService(jwtCfg());

    private static AppProperties.Jwt jwtCfg() {
        AppProperties.Jwt cfg = new AppProperties.Jwt();
        cfg.setSecret(TEST_SECRET);
        cfg.setExpireHours(24);
        return cfg;
    }

    @Test
    void generateAndParse() {
        String token = jwtService.generateToken(42, "openid-abc");
        JwtService.JwtClaims claims = jwtService.parseToken(token);
        assertThat(claims.userId()).isEqualTo(42);
        assertThat(claims.openid()).isEqualTo("openid-abc");
    }

    @Test
    void invalidTokenThrows() {
        assertThatThrownBy(() -> jwtService.parseToken("garbage.token.value"))
                .isInstanceOf(BizException.class);
    }
}
```

`AuthInterceptorTest.java`:

```java
package com.guyu.stock.auth;

import com.guyu.stock.config.AppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class AuthInterceptorTest {

    private static final String TEST_SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private JwtService jwtService;
    private AuthInterceptor interceptor;

    @BeforeEach
    void setUp() {
        AppProperties.Jwt jwtCfg = new AppProperties.Jwt();
        jwtCfg.setSecret(TEST_SECRET);
        jwtCfg.setExpireHours(24);
        jwtService = new JwtService(jwtCfg);
        interceptor = new AuthInterceptor(jwtService);
    }

    @Test
    void missingTokenRejected() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/user/profile");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        boolean ok = interceptor.preHandle(req, resp, new Object());
        assertThat(ok).isFalse();
        assertThat(resp.getStatus()).isEqualTo(200);
    }

    @Test
    void validTokenAccepted() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/user/profile");
        req.addHeader("Authorization", "Bearer " + jwtService.generateToken(7, "openid-x"));
        boolean ok = interceptor.preHandle(req, new MockHttpServletResponse(), new Object());
        assertThat(ok).isTrue();
        assertThat(req.getAttribute("user_id")).isEqualTo(7L);
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn test -Dtest=JwtServiceTest,AuthInterceptorTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`User.java`（JSON 字段对齐 Go model：id/nickname/avatar_url/status/last_login_at/created_at/updated_at 暴露，openid/unionid/session_key/phone_enc 不暴露）：

```java
package com.guyu.stock.user;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDateTime;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record User(
        long id,
        @JsonIgnore String openid,
        @JsonIgnore String unionid,
        @JsonIgnore String sessionKey,
        String nickname,
        String avatarUrl,
        @JsonIgnore String phoneEnc,
        int status,
        LocalDateTime lastLoginAt,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public User withId(long newId) {
        return new User(newId, openid, unionid, sessionKey, nickname, avatarUrl, phoneEnc, status, lastLoginAt, createdAt, updatedAt);
    }
}
```

`UserRepository.java`:

```java
package com.guyu.stock.user;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.LocalDateTime;

@Repository
public class UserRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<User> MAPPER = (rs, i) -> {
        Timestamp last = rs.getTimestamp("last_login_at");
        Timestamp created = rs.getTimestamp("created_at");
        Timestamp updated = rs.getTimestamp("updated_at");
        return new User(
                rs.getLong("id"),
                rs.getString("openid"),
                rs.getString("unionid"),
                rs.getString("session_key"),
                rs.getString("nickname"),
                rs.getString("avatar_url"),
                rs.getString("phone_enc"),
                rs.getInt("status"),
                last != null ? last.toLocalDateTime() : null,
                created != null ? created.toLocalDateTime() : null,
                updated != null ? updated.toLocalDateTime() : null
        );
    };

    public User findByOpenId(String openid) {
        var users = jdbcTemplate.query("SELECT * FROM users WHERE openid = ?", MAPPER, openid);
        return users.isEmpty() ? null : users.get(0);
    }

    public User create(User user) {
        LocalDateTime now = LocalDateTime.now();
        KeyHolder kh = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO users (openid, unionid, session_key, status, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id",
                    new String[]{"id"});
            ps.setString(1, user.openid());
            ps.setString(2, user.unionid());
            ps.setString(3, user.sessionKey());
            ps.setInt(4, 1);
            ps.setTimestamp(5, Timestamp.valueOf(now));
            ps.setTimestamp(6, Timestamp.valueOf(now));
            return ps;
        }, kh);
        return user.withId(kh.getKey().longValue());
    }

    public void updateLogin(User user) {
        jdbcTemplate.update(
                "UPDATE users SET session_key = ?, unionid = COALESCE(?, unionid), last_login_at = ?, updated_at = ? WHERE id = ?",
                user.sessionKey(), user.unionid(), Timestamp.valueOf(LocalDateTime.now()),
                Timestamp.valueOf(LocalDateTime.now()), user.id());
    }
}
```

`JwtService.java`:

```java
package com.guyu.stock.auth;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

public class JwtService {

    public record JwtClaims(long userId, String openid) {}

    private final AppProperties.Jwt jwtCfg;
    private final SecretKey key;

    public JwtService(AppProperties.Jwt jwtCfg) {
        this.jwtCfg = jwtCfg;
        // 与 Go []byte(secret) 完全一致：用 secret 字符串的 UTF-8 字节作为 HMAC 密钥
        this.key = Keys.hmacShaKeyFor(jwtCfg.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String generateToken(long userId, String openid) {
        int hours = jwtCfg.getExpireHours() <= 0 ? 24 : jwtCfg.getExpireHours();
        Instant now = Instant.now();
        return Jwts.builder()
                .claim("user_id", userId)
                .claim("openid", openid)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(Duration.ofHours(hours))))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    public JwtClaims parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Object uid = claims.get("user_id");
            long userId = uid instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(uid));
            return new JwtClaims(userId, claims.get("openid", String.class));
        } catch (Exception e) {
            throw new BizException(ErrCode.TOKEN_INVALID, ErrCode.msg(ErrCode.TOKEN_INVALID));
        }
    }
}
```

`WechatService.java`:

```java
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
```

`AuthInterceptor.java`（拒绝时直接向 response 写 `ApiResponse` JSON，HTTP 200）：

```java
package com.guyu.stock.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.ErrCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final JwtService jwtService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AuthInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || authHeader.isBlank()) {
            return reject(response, ErrCode.TOKEN_MISSING, ErrCode.msg(ErrCode.TOKEN_MISSING));
        }
        if (!authHeader.startsWith("Bearer ")) {
            return reject(response, ErrCode.TOKEN_MISSING, "认证格式错误，应为 Bearer <token>");
        }
        String token = authHeader.substring("Bearer ".length());
        try {
            JwtService.JwtClaims claims = jwtService.parseToken(token);
            request.setAttribute("user_id", claims.userId());
            request.setAttribute("openid", claims.openid());
            return true;
        } catch (Exception e) {
            return reject(response, ErrCode.TOKEN_INVALID, ErrCode.msg(ErrCode.TOKEN_INVALID));
        }
    }

    private boolean reject(HttpServletResponse response, int code, String msg) throws Exception {
        response.setStatus(200);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(code, msg)));
        return false;
    }
}
```

`AuthController.java`:

```java
package com.guyu.stock.auth;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.user.User;
import com.guyu.stock.user.UserRepository;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final WechatService wechatService;
    private final UserRepository userRepository;
    private final JwtService jwtService;

    public AuthController(WechatService wechatService, UserRepository userRepository, JwtService jwtService) {
        this.wechatService = wechatService;
        this.userRepository = userRepository;
        this.jwtService = jwtService;
    }

    public record LoginRequest(String code) {}

    @PostMapping("/login")
    public ApiResponse<Map<String, Object>> login(@RequestBody LoginRequest req) {
        if (req.code() == null || req.code().isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "code 不能为空");
        }
        try {
            Map<String, Object> session = wechatService.code2Session(req.code());
            String openid = (String) session.get("openid");
            String sessionKey = (String) session.get("session_key");
            String unionid = session.get("unionid") == null ? null : (String) session.get("unionid");

            User user = userRepository.findByOpenId(openid);
            if (user == null) {
                user = userRepository.create(new User(0, openid, unionid, sessionKey, null, null, null, 1, null, null, null));
            } else {
                userRepository.updateLogin(user);
            }

            String token = jwtService.generateToken(user.id(), user.openid());
            int expireHours = 24;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("token", token);
            result.put("expires_in", (long) expireHours * 3600);
            result.put("user", user);
            return ApiResponse.success(result);
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException(ErrCode.WX_LOGIN_FAIL, ErrCode.msg(ErrCode.WX_LOGIN_FAIL));
        }
    }
}
```

`UserController.java`:

```java
package com.guyu.stock.auth;

import com.guyu.stock.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/user")
public class UserController {

    @GetMapping("/profile")
    public ApiResponse<Map<String, Object>> profile(HttpServletRequest request) {
        Object userId = request.getAttribute("user_id");
        return ApiResponse.success(Map.of("user_id", userId));
    }
}
```

`WebConfig.java`（注册拦截器，只拦 `/api/v1/user/**`，其余公开）：

```java
package com.guyu.stock.config;

import com.guyu.stock.auth.AuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    public WebConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/v1/user/**");
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn test -Dtest=JwtServiceTest,AuthInterceptorTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/user src/main/java/com/guyu/stock/auth src/main/java/com/guyu/stock/config/WebConfig.java src/test/java/com/guyu/stock/auth src/test/resources/schema.sql
git commit -m "feat: add WeChat login, JWT auth and user profile endpoint"
```

---

### Task 6: 新浪实时行情（quote / quotes）

**Files:**
- Create: `src/main/java/com/guyu/stock/external/sina/Quote.java`
- Create: `src/main/java/com/guyu/stock/external/sina/SinaClient.java`
- Create: `src/main/java/com/guyu/stock/external/sina/SinaQuoteService.java`
- Modify: `src/main/java/com/guyu/stock/stock/StockController.java`（加 quote/quotes 两个端点）
- Test: `src/test/java/com/guyu/stock/external/sina/SinaQuoteParserTest.java`
- Test: `src/test/java/com/guyu/stock/external/sina/SinaQuoteServiceTest.java`

**Interfaces:**
- Consumes: `AppProperties.Sina`（限流/UA/Referer）、`ApiResponse`
- Produces:
  - `record Quote(String code, String name, double open, double prevClose, double price, double high, double low, long volume, double amount, String date, String time, double turnover, double pctChange)`（JSON：`prev_close`/`pct_change` 下划线）
  - `List<Quote> SinaClient.fetchQuotes(List<String> codes)`（GBK 解码 + 解析，不缓存）
  - `List<Quote> SinaClient.parseBody(String body)`（供测试）
  - `String SinaClient.toSymbol(String code)`
  - `Quote SinaQuoteService.getQuote(String code)`（Caffeine 3s，未命中调 client）
  - `List<Quote> SinaQuoteService.getBatchQuotes(List<String> codes)`（Caffeine key=排序后 join，TTL 3s）
  - `StockController`：`GET /api/v1/stock/{code}/quote` → `{code:200, data: Quote}`；`GET /api/v1/stock/quotes?codes=a,b,c` → `{code:200, data: [Quote]}`（≤50）

- [ ] **Step 1: 写失败测试**

`SinaQuoteParserTest.java`（不发起网络，纯解析；构造 GBK 字节模拟响应）：

```java
package com.guyu.stock.external.sina;

import com.guyu.stock.config.AppProperties;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SinaQuoteParserTest {

    private final SinaClient client = new SinaClient(new AppProperties.Sina());

    // 模拟 hq.sinajs.cn 响应字节：头部/尾部是 ASCII，名称是 GBK 中文
    private byte[] gbkBody(String line) {
        String prefix = "var hq_str_sh600519=\"";
        String suffix = "\";";
        byte[] prefixBytes = prefix.getBytes(StandardCharsets.ISO_8859_1);
        byte[] gbkBytes = line.getBytes(Charset.forName("GBK"));
        byte[] suffixBytes = suffix.getBytes(StandardCharsets.ISO_8859_1);
        byte[] out = new byte[prefixBytes.length + gbkBytes.length + suffixBytes.length];
        System.arraycopy(prefixBytes, 0, out, 0, prefixBytes.length);
        System.arraycopy(gbkBytes, 0, out, prefixBytes.length, gbkBytes.length);
        System.arraycopy(suffixBytes, 0, out, prefixBytes.length + gbkBytes.length, suffixBytes.length);
        return out;
    }

    @Test
    void parsesQuoteFromGbkBody() {
        String[] fields = new String[32];
        fields[0] = "贵州茅台";
        fields[1] = "1700.00"; // open
        fields[2] = "1690.00"; // prev_close
        fields[3] = "1710.00"; // price
        fields[4] = "1730.00"; // high
        fields[5] = "1680.00"; // low
        fields[6] = "0"; fields[7] = "0"; // bid/ask
        fields[8] = "10000";  // volume
        fields[9] = "17000000"; // amount
        for (int i = 10; i <= 29; i++) fields[i] = "0";
        fields[30] = "2026-08-07";
        fields[31] = "15:00:03";

        String line = String.join(",", fields);
        // 模拟 SinaClient 内部：byte[] 按 ISO-8859-1 重编码后传给 parseBody
        String isoBody = new String(gbkBody(line), StandardCharsets.ISO_8859_1);
        List<Quote> quotes = client.parseBody(isoBody);

        assertThat(quotes).hasSize(1);
        Quote q = quotes.get(0);
        assertThat(q.code()).isEqualTo("600519");
        assertThat(q.name()).isEqualTo("贵州茅台");
        assertThat(q.open()).isEqualTo(1700.00);
        assertThat(q.prevClose()).isEqualTo(1690.00);
        assertThat(q.price()).isEqualTo(1710.00);
        assertThat(q.volume()).isEqualTo(10000);
        assertThat(q.amount()).isEqualTo(17000000);
        assertThat(q.date()).isEqualTo("2026-08-07");
        assertThat(q.time()).isEqualTo("15:00:03");
        assertThat(q.pctChange()).isEqualTo((1710.0 - 1690.0) / 1690.0 * 100);
    }

    @Test
    void toSymbolMapsShAndSz() {
        assertThat(client.toSymbol("600001")).isEqualTo("sh600001");
        assertThat(client.toSymbol("900001")).isEqualTo("sh900001");
        assertThat(client.toSymbol("000001")).isEqualTo("sz000001");
        assertThat(client.toSymbol("300750")).isEqualTo("sz300750");
    }
}
```

`SinaQuoteServiceTest.java`（用 stub 的 `SinaClient` 验证缓存；`SinaClient` 需能被继承且 `fetchQuotes` 可重写）：

```java
package com.guyu.stock.external.sina;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class SinaQuoteServiceTest {

    static class StubClient extends SinaClient {
        final AtomicInteger calls = new AtomicInteger();
        StubClient() { super(new com.guyu.stock.config.AppProperties.Sina()); }
        @Override
        public List<Quote> fetchQuotes(List<String> codes) {
            calls.incrementAndGet();
            return codes.stream().map(c -> new Quote(c, "名称", 1, 1, 1, 1, 1, 0, 0, "2026-08-07", "15:00:00", 0, 0)).toList();
        }
    }

    @Test
    void getQuoteCachesWithinTtl() {
        StubClient client = new StubClient();
        SinaQuoteService service = new SinaQuoteService(client);
        service.getQuote("600001");
        service.getQuote("600001");
        assertThat(client.calls.get()).isEqualTo(1); // 命中缓存，只调一次
    }

    @Test
    void getQuoteReturnsQuote() {
        StubClient client = new StubClient();
        SinaQuoteService service = new SinaQuoteService(client);
        Quote q = service.getQuote("600001");
        assertThat(q.code()).isEqualTo("600001");
    }
}
```

- [ ] **Step 2: 运行验证失败**

Run: `mvn test -Dtest=SinaQuoteParserTest,SinaQuoteServiceTest`
Expected: FAIL（类不存在）

- [ ] **Step 3: 实现**

`Quote.java`（JSON 字段名对齐 Go `Quote` struct）：

```java
package com.guyu.stock.external.sina;

import com.fasterxml.jackson.annotation.JsonProperty;

public record Quote(
        String code,
        String name,
        double open,
        @JsonProperty("prev_close") double prevClose,
        double price,
        double high,
        double low,
        long volume,
        double amount,
        String date,
        String time,
        double turnover,
        @JsonProperty("pct_change") double pctChange
) {}
```

`SinaClient.java`（`@Component`，构造器注入 `AppProperties.Sina`；`fetchQuotes` 为 public 可重写便于测试）：

```java
package com.guyu.stock.external.sina;

import com.google.common.util.concurrent.RateLimiter;
import com.guyu.stock.config.AppProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@Component
public class SinaClient {

    private static final String QUOTE_URL = "http://hq.sinajs.cn/list=";

    private final RestClient restClient;
    private final RateLimiter rateLimiter;

    public SinaClient(AppProperties.Sina sinaCfg) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        int timeoutMs = (int) (sinaCfg.getTimeoutSeconds() <= 0 ? 30 : sinaCfg.getTimeoutSeconds()) * 1000;
        factory.setConnectTimeout(timeoutMs);
        factory.setReadTimeout(timeoutMs);
        RestClient.Builder builder = RestClient.builder().requestFactory(factory);
        // null 保护：测试环境下 UA/Referer 可能未配置，RestClient.defaultHeader 不接受 null
        if (sinaCfg.getUserAgent() != null && !sinaCfg.getUserAgent().isBlank()) {
            builder.defaultHeader(HttpHeaders.USER_AGENT, sinaCfg.getUserAgent());
        }
        if (sinaCfg.getReferer() != null && !sinaCfg.getReferer().isBlank()) {
            builder.defaultHeader(HttpHeaders.REFERER, sinaCfg.getReferer());
        }
        this.restClient = builder.build();
        double interval = sinaCfg.getRateLimitSeconds() <= 0 ? 1.0 : sinaCfg.getRateLimitSeconds();
        this.rateLimiter = RateLimiter.create(1.0 / interval);
    }

    /** 6/9 开头 → sh，其他 → sz（对齐 Go toSymbol） */
    public String toSymbol(String code) {
        if (code == null || code.isEmpty()) return code;
        char first = code.charAt(0);
        return (first == '6' || first == '9') ? "sh" + code : "sz" + code;
    }

    /** 拉取行情；每次请求前取限流令牌（对齐 Go Limiter.Wait） */
    public List<Quote> fetchQuotes(List<String> codes) {
        if (codes == null || codes.isEmpty()) return List.of();
        rateLimiter.acquire();
        List<String> symbols = codes.stream().map(this::toSymbol).toList();
        String url = QUOTE_URL + String.join(",", symbols);
        byte[] raw = restClient.get().uri(url).retrieve().body(byte[].class);
        if (raw == null) return List.of();
        // 保留 GBK 字节：先按 ISO-8859-1 转 String（不丢字节），parseBody 里名称字段再按 GBK 解码
        String body = new String(raw, StandardCharsets.ISO_8859_1);
        return parseBody(body);
    }

    /** 解析响应文本（body 为 ISO-8859-1 重编码串，名称字段含 GBK 中文）。供测试直接调用。 */
    public List<Quote> parseBody(String body) {
        List<Quote> quotes = new ArrayList<>();
        for (String line : body.split("\n")) {
            line = line.trim();
            if (line.isEmpty() || !line.contains("=")) continue;
            int eq = line.indexOf("=");
            String symbolPart = line.substring(0, eq);
            String code = "";
            int underscore = symbolPart.lastIndexOf('_');
            if (underscore >= 0) {
                String symbol = symbolPart.substring(underscore + 1);
                code = symbol.length() > 2 ? symbol.substring(2) : symbol;
            }
            int quoteStart = line.indexOf('"');
            if (quoteStart < 0) continue;
            String rest = line.substring(quoteStart + 1);
            int quoteEnd = rest.lastIndexOf('"');
            if (quoteEnd < 0) continue;
            String raw = rest.substring(0, quoteEnd);
            Quote q = parseOneQuote(code, raw);
            if (q != null) quotes.add(q);
        }
        return quotes;
    }

    Quote parseOneQuote(String code, String line) {
        String[] fields = line.split(",", -1);
        if (fields.length < 32) return null;
        String name = decodeGbk(fields[0]);
        double prevClose = parseDouble(fields[2]);
        double price = parseDouble(fields[3]);
        double pctChange = prevClose != 0 ? (price - prevClose) / prevClose * 100 : 0;
        return new Quote(
                code,
                name,
                parseDouble(fields[1]),      // open
                prevClose,
                price,
                parseDouble(fields[4]),      // high
                parseDouble(fields[5]),      // low
                parseLong(fields[8]),        // volume
                parseDouble(fields[9]),      // amount
                safeField(fields, 30),       // date
                safeField(fields, 31),       // time
                0,                           // turnover 恒 0（对齐 Go）
                pctChange
        );
    }

    /** 字段0名称是 GBK 中文，其余 ASCII；把 ISO-8859-1 编码字节还原再按 GBK 解码 */
    private String decodeGbk(String s) {
        byte[] bytes = s.getBytes(StandardCharsets.ISO_8859_1);
        return new String(bytes, Charset.forName("GBK"));
    }

    private String safeField(String[] fields, int idx) {
        return idx < fields.length ? fields[idx].trim() : "";
    }

    private double parseDouble(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
```

`SinaQuoteService.java`:

```java
package com.guyu.stock.external.sina;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;

@Service
public class SinaQuoteService {

    private static final Duration TTL = Duration.ofSeconds(3);

    private final SinaClient client;
    private final Cache<String, Quote> quoteCache;
    private final Cache<String, List<Quote>> batchCache;

    public SinaQuoteService(SinaClient client) {
        this.client = client;
        this.quoteCache = Caffeine.newBuilder().expireAfterWrite(TTL).build();
        this.batchCache = Caffeine.newBuilder().expireAfterWrite(TTL).build();
    }

    public Quote getQuote(String code) {
        Quote cached = quoteCache.getIfPresent(code);
        if (cached != null) return cached;

        List<Quote> quotes = client.fetchQuotes(List.of(code));
        if (quotes.isEmpty()) {
            throw new BizException(ErrCode.SERVER_ERROR, "未找到 " + code + " 的行情数据");
        }
        Quote q = quotes.get(0);
        quoteCache.put(code, q);
        return q;
    }

    public List<Quote> getBatchQuotes(List<String> codes) {
        List<String> sorted = codes.stream().sorted().toList();
        String key = String.join(",", sorted);
        List<Quote> cached = batchCache.getIfPresent(key);
        if (cached != null) return cached;

        List<Quote> quotes = client.fetchQuotes(codes);
        batchCache.put(key, quotes);
        return quotes;
    }
}
```

修改 `StockController.java`：增加 `SinaQuoteService` 依赖 + 两个端点。

构造器改为：

```java
private final StockService stockService;
private final SinaQuoteService sinaQuoteService;

public StockController(StockService stockService, SinaQuoteService sinaQuoteService) {
    this.stockService = stockService;
    this.sinaQuoteService = sinaQuoteService;
}
```

新增 import 与端点：

```java
import com.guyu.stock.external.sina.Quote;
import com.guyu.stock.external.sina.SinaQuoteService;
import java.util.Arrays;
import java.util.List;

@GetMapping("/{code}/quote")
public ApiResponse<Quote> getQuote(@PathVariable("code") String code) {
    if (code == null || code.isBlank()) {
        throw new BizException(ErrCode.INVALID_PARAM, "股票代码不能为空");
    }
    return ApiResponse.success(sinaQuoteService.getQuote(code));
}

@GetMapping("/quotes")
public ApiResponse<List<Quote>> getQuotes(@RequestParam("codes") String codesStr) {
    if (codesStr == null || codesStr.isBlank()) {
        throw new BizException(ErrCode.INVALID_PARAM, "codes 参数必填，逗号分隔");
    }
    List<String> codes = Arrays.stream(codesStr.split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).toList();
    if (codes.isEmpty()) {
        throw new BizException(ErrCode.INVALID_PARAM, "股票代码列表为空");
    }
    if (codes.size() > 50) {
        throw new BizException(ErrCode.INVALID_PARAM, "一次最多查询 50 只股票");
    }
    return ApiResponse.success(sinaQuoteService.getBatchQuotes(codes));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `mvn test -Dtest=SinaQuoteParserTest,SinaQuoteServiceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/guyu/stock/external/sina src/main/java/com/guyu/stock/stock/StockController.java src/test/java/com/guyu/stock/external/sina
git commit -m "feat: add Sina real-time quote client with rate limit and cache"
```

---

### Task 7: 集成验证 + README

**Files:**
- Create: `backend-java/README.md`

**Interfaces:**
- Consumes: 前 6 个任务全部产物

- [ ] **Step 1: 全量单测**

Run: `cd backend-java && mvn test`
Expected: 全部 PASS

- [ ] **Step 2: 启动应用连现网库**

前置：先设置环境变量（值从 Go 版 `backend/config.yaml` 或部署环境获取）：

```bash
export DB_HOST=118.178.112.125 DB_PORT=5432 DB_NAME=gu_yu_stock DB_USER=root DB_PASSWORD=<从部署环境获取> \
       JWT_SECRET=<从部署环境获取> WECHAT_APP_ID=<从部署环境获取> WECHAT_APP_SECRET=<从部署环境获取>
cd backend-java && mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

Expected: 启动日志无异常，监听 18487

- [ ] **Step 3: 逐接口对比验证**

用 `api-test.http`（backend/ 下）的请求对 Java 版逐一 curl，与 Go 版响应结构核对：

```bash
# 健康检查（不包装）
curl -s http://localhost:18487/api/health
# 期望 {"status":"ok","database":"connected"}

# 搜索
curl -s 'http://localhost:18487/api/v1/stock/search?q=茅台&limit=5'
# 期望 {code:200, data:{keyword,count,stocks:[{code,name,...}]}}

# K线（日线）
curl -s 'http://localhost:18487/api/v1/stock/600519/klines?scale=240&count=3'
# 期望 data.klines 升序，time 为 yyyy-MM-dd

# 行情（连新浪，需外网）
curl -s 'http://localhost:18487/api/v1/stock/600519/quote'
# 期望 {code:200, data:{code,name,open,prev_close,price,high,low,volume,amount,date,time,turnover,pct_change}}
```

对照项：JSON 字段名、`{code,msg,data}` 结构、K 线升序、quote 字段名（`prev_close`/`pct_change` 下划线）。

- [ ] **Step 4: 写 README**

`backend-java/README.md` 内容要点：启动方式（环境变量 + `mvn spring-boot:run -Dspring-boot.run.profiles=dev`）、配置说明（application.yml / 环境变量清单）、接口清单、与 Go 版契约一致性说明、环境变量清单（不写真实值）。

- [ ] **Step 5: 提交**

```bash
git add backend-java/README.md
git commit -m "docs: add backend-java README and integration verification"
```

---

## Self-Review

**Spec coverage：**
- 工程骨架 ✓（Task 1）｜统一响应/异常 ✓（Task 2）｜DB/K线 ✓（Task 3-4）｜搜索 ✓（Task 4）｜微信登录+JWT+profile ✓（Task 5）｜新浪行情 ✓（Task 6）｜集成验证 ✓（Task 7）
- health 不走 R 包装 ✓（Task 1）
- B 阶段不做新浪 K 线回退 ✓（Task 4，仅 DB + 非 240/1200 报参数错误）
- 生产密钥不落盘 ✓（全部 `${ENV}` 占位；JWT/DB 值通过环境变量注入）

**类型一致性：**
- `StockKline`/`StockInfo` record 在 Task 3/4 定义，Task 4 service 引用一致
- `SinaClient.parseBody`/`toSymbol`/`fetchQuotes` 在 Task 6 测试与实现签名一致（`fetchQuotes` public 可重写，`StubClient` 依赖此点）
- `JwtService`（构造器 `AppProperties.Jwt`，`generateToken(long,String)`，`parseToken`→`JwtClaims(userId,openid)`）在 Task 5 测试与实现一致
- `AuthInterceptor` 测试断言 `resp.getStatus()==200` 与实现 `reject()` 写 HTTP 200 一致

**说明**：`@JdbcTest` 默认从 `src/test/resources/schema.sql` 加载建表脚本，故测试 schema 文件命名为 `schema.sql`（Task 3 中已注明），Task 4/5 向同一文件追加建表语句。
