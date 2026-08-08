# Go 后端 → Java Spring Boot 迁移设计（B 阶段）

> 日期：2026-08-08
> 分支：`feat/go-to-java-spring-analysis`
> 前置分析：`docs/go-to-java-spring-analysis.md`（可行性结论：非常好转）

## 一、目标与范围

将 `wx-app-stock` 的 Go 后端（`backend/`，Gin + sqlx + PostgreSQL）迁移为 **Spring Boot** 实现。

**B 阶段目标**：搭建 `backend-java/` 工程骨架，实现 7 个核心接口并跑通前后端链路，作为整个迁移的第一个里程碑。

**明确的 gate**：`backend/`（Go）在完全迁移并对比验证通过之前**保留不动、继续线上运行**；达到里程碑 M3 后删除。

## 二、已定决策

| 决策点 | 方案 |
|---|---|
| 工程位置 | `backend-java/`，与 `backend/` 并存 |
| 技术栈 | Java 21 + Maven + Spring Boot 3.3.x |
| 数据访问 | Spring JDBC（`JdbcTemplate`），手写 SQL 原样保留 |
| 数据库 | 直连现网 PostgreSQL（`gu_yu_stock`），B 阶段只读 |
| 认证 | 微信登录 + JWT（jjwt，HS256，复用同一 secret） |
| 新浪行情 HTTP | Spring `RestClient` |
| 限流 | Guava `RateLimiter`（1s/次，对应 Go `rate.NewLimiter`） |
| 缓存 | Caffeine（实时行情 TTL 3 秒，对应 Go 自建缓存） |
| 包名 | `com.guyu.stock` |
| API 契约 | 路径、参数、`{code,msg,data}` 响应结构完全对齐 Go 版，前端零改动 |

## 三、工程结构

```
backend-java/
├── pom.xml                          # Spring Boot 3.3.x, Java 21
├── src/main/java/com/guyu/stock/
│   ├── StockApplication.java        # 启动类
│   ├── config/                      # DataSourceConfig, JwtProperties, SinaProperties...
│   ├── common/
│   │   ├── ApiResponse.java         # {code,msg,data}
│   │   ├── BizException.java        # 业务异常(code,msg)
│   │   └── GlobalExceptionHandler   # @RestControllerAdvice
│   ├── auth/
│   │   ├── AuthController.java      # POST /api/v1/auth/login
│   │   ├── UserController.java      # GET /api/v1/user/profile
│   │   ├── WechatService.java       # code2Session
│   │   ├── JwtService.java          # jjwt 签发/校验 HS256
│   │   └── AuthInterceptor.java     # Bearer token 解析
│   ├── stock/
│   │   ├── StockController.java     # search / klines / quote / quotes
│   │   ├── StockService.java
│   │   ├── StockKlineRepository.java
│   │   └── StockInfoRepository.java
│   ├── user/
│   │   └── UserRepository.java
│   └── external/sina/
│       ├── SinaClient.java          # RestClient + 限流 + 重试 + GBK
│       └── SinaQuoteService.java    # 实时行情 + Caffeine 缓存
└── src/main/resources/
    ├── application.yml
    └── application-dev.yml
```

### Go → Java 架构对应

| Go | Java |
|---|---|
| `main.go` 手动依赖注入 | Spring 容器 + `@Configuration` |
| `handler/*` | `@RestController` + `@Service` |
| `repository/*` | `@Repository`（JdbcTemplate） |
| `model/*` | POJO（`@JsonProperty` 控制字段名） |
| `middleware/jwt.go` | `AuthInterceptor` + `WebMvcConfigurer` |
| `pkg/response` + `Recovery` | `ApiResponse` + `GlobalExceptionHandler` |
| `pkg/sina` + `pkg/fetcher` | `external/sina` |
| `pkg/cache` | Caffeine |
| `config.yaml` | `application.yml` |

### pom 依赖

`spring-boot-starter-web`、`spring-boot-starter-jdbc`、`spring-boot-starter-validation`、`postgresql`、`jjwt-api/impl/jackson`、`guava`、`caffeine`、`lombok`、`spring-boot-starter-test`。

### 配置

`application.yml` 平移自 `backend/config.yaml`：
- `spring.datasource.*`（现网 PostgreSQL，B 阶段只读）
- `app.jwt.secret`、`app.jwt.expire-hours`（复用 Go 版同一 secret）
- `app.wechat.app-id`、`app.wechat.app-secret`
- `app.sina.rate-limit`、`app.sina.max-retries`、`app.sina.timeout`、UA/Referer

## 四、核心接口与数据流

### 1. `GET /api/health`
对 DB ping，成功返回 HTTP 200 + `{"status":"ok","database":"connected"}`；DB 不可用时 `{"status":"degraded","database":"disconnected: <err>"}`。
**注意：不走 R 包装**（该接口供服务器/CI 健康检查，前端 `request.ts` 不调用），HTTP 状态码恒为 200，JSON 字段与 Go 版 `healthHandler` 完全一致。

### 2. `POST /api/v1/auth/login`（body: `{"code":"..."}`）
`WechatService.code2Session` → `UserRepository.findByOpenId`（查无则 create，有则 updateLogin）→ `JwtService` 签发 HS256（claims：`user_id`、`openid`，24h，同一 secret）→ `{token, expires_in, user}`。

### 3. `GET /api/v1/user/profile`（需认证）
`AuthInterceptor` 校验 Bearer token，注入 `user_id`，返回 `{user_id}`。

### 4. `GET /api/v1/stock/search?q=&limit=`
`StockInfoRepository.search` 按代码/名称模糊查 `stock_info`，返回 `{keyword, count, stocks}`。

### 5. `GET /api/v1/stock/:code/klines?scale=&count=`
- scale 映射 `240→1d`、`1200→1w`（对应 `scaleToDB`）
- `StockKlineRepository.queryByCode` 查 `stock_kline` 倒序，组装 API 返回升序
- 返回 `{code, scale, klines:[{time:"yyyy-MM-dd", open, high, low, close, volume}], count}`
- **B 阶段不做 DB 未命中回退新浪**（DB 有全量数据，回退逻辑与新浪 K 线客户端一并放 C 阶段）

### 6. `GET /api/v1/stock/:code/quote` 与 7. `GET /api/v1/stock/quotes?codes=`
- `SinaQuoteService`：Caffeine 缓存（key=code，TTL 3s）→ 未命中调 `SinaClient`
- `SinaClient`：URL `http://hq.sinajs.cn/list=sh600001`（`toSymbol`：6/9→sh，其他→sz），RestClient + UA/Referer + Guava RateLimiter 1s/次，GBK 解码（`new String(body.getBytes("ISO-8859-1"), "GBK")`），解析 `var hq_str_xxx="..."` 逗号分隔字段
- 返回结构字段名对齐 Go `sina/quote.go` 的 `QuoteData`

## 五、错误处理

- HTTP 状态码固定 200，业务码在 body（对齐 Go，前端只认 `code`）
- `BizException(code,msg)` → `GlobalExceptionHandler` → `{code,msg}`
- 认证失败 `TOKEN_MISSING`/`TOKEN_INVALID`（code=401）、参数错误 `INVALID_PARAM`（code=400）、未知异常 `SERVER_ERROR`（code=500，日志记详情）
- `ErrCode` 常量从 `pkg/errcode/errcode.go` 原样搬移

## 六、测试

1. 单元测试：JwtService 签发/校验/过期、SinaQuoteParser GBK 样本解析、StockService scale 映射与 K 线顺序、ErrCode
2. 集成验证：本机启动后，用 `api-test.http` 同一批请求**逐接口对比 Java 版与 Go 版响应**，核对 JSON 字段名、`{code,msg,data}` 结构、K 线顺序、quote 字段名

## 七、里程碑

```
M1  本阶段(B)：backend-java 7 接口通过对比验证；Go 版保留、线上不动
M2  下一阶段(C)：板块/news/公告 + 数据采集(新浪/东财/巨潮/同花顺)，功能全覆盖
M3  Java 版完整跑通 + 响应全量 diff 通过
     ├─ 删除 backend/（Go 源码）
     ├─ Java 版接管部署
     └─ 更新 CI（.github/workflows/deploy.yml 构建 backend-java）
```

**删除 Go 版的 gate = M3**（功能全量覆盖 + 对比验证通过）。M1/M2 期间 Go 版始终是线上兜底。
