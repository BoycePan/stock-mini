# backend-java

wx-app-stock 的 Java Spring Boot 后端，Go 版迁移（B + C 阶段）。

B 阶段已实现：健康检查、统一响应/异常、股票搜索、K 线（DB）、微信登录 + JWT + 个人资料、新浪实时行情。
C 阶段已实现：概念板块（列表/板块K线/成分股）、个股新闻/新闻feed/巨潮公告、分钟级 K 线（5/15/30/60）、数据采集服务与定时任务。
与 Go 版 `backend/` 并存运行，前端零改动。

## 技术栈

- Java 21
- Spring Boot 3.3.x
- Spring JDBC（`JdbcTemplate`）
- PostgreSQL
- jjwt（JWT 签发与校验）
- Guava
- Caffeine

## 启动方式

配置通过 `.env` 提供。复制模板并填入真实值：

```bash
cp .env.example .env   # 填入数据库/微信/JWT 真实值（.env 已被 git 忽略）
mvn spring-boot:run
```

`spring-dotenv` 在启动时读取工作目录的 `.env`（等价于环境变量，OS 环境变量优先级更高），键名对齐 Go 版 `backend/config.yaml`。服务默认监听 `18487` 端口（见 `application.yml` 的 `server.port`）。

## 配置说明

`.env` 键名对齐 Go 版 `backend/config.yaml` 字段，映射如下：

| `.env` 变量 | 对应 Go 配置 | 用途 |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `database.*` | PostgreSQL 连接 |
| `JWT_SECRET` | `jwt.secret` | JWT 签名密钥（必须 ≥ 32 字节） |
| `JWT_EXPIRE_HOURS` | `jwt.expire_hours` | JWT 有效期（小时，默认 24） |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | `wechat.app_id` / `wechat.app_secret` | 微信小程序 AppID / AppSecret |
| `SINA_RATE_LIMIT` | `stock.sina.rate_limit` | 新浪行情请求间隔（秒，默认 1.0） |
| `SINA_MAX_RETRIES` | `stock.sina.max_retries` | 新浪重试次数（默认 3） |
| `SINA_TIMEOUT` | `stock.sina.timeout` | 新浪超时（秒，默认 30） |
| `EASTMONEY_RATE_LIMIT` | `stock.eastmoney.rate_limit` | 东方财富请求间隔（秒，默认 4.0，最保守） |
| `EASTMONEY_MAX_RETRIES` | `stock.eastmoney.max_retries` | 东方财富重试次数（默认 5） |
| `EASTMONEY_TIMEOUT` | `stock.eastmoney.timeout` | 东方财富超时（秒，默认 30） |
| `CNINFO_RATE_LIMIT` | `stock.cninfo.rate_limit` | 巨潮资讯请求间隔（秒，默认 0 不限流） |
| `CNINFO_MAX_RETRIES` | `stock.cninfo.max_retries` | 巨潮资讯重试次数（默认 1） |
| `CNINFO_TIMEOUT` | `stock.cninfo.timeout` | 巨潮资讯超时（秒，默认 30） |
| `THS_RATE_LIMIT` | `stock.ths.rate_limit` | 同花顺请求间隔（秒，默认 0.5） |
| `THS_MAX_RETRIES` | `stock.ths.max_retries` | 同花顺重试次数（默认 3） |
| `THS_TIMEOUT` | `stock.ths.timeout` | 同花顺超时（秒，默认 30） |

四个数据源的限流/重试/超时均通过 `app.*` 配置注入 `DataSource`（`BeanConfig` 中构造），不再硬编码；默认值与 Go 版 `config.yaml` 的 `stock.*` 段一致。东方财富 `EastmoneyKlineClient` 已提供（含成交额 + 换手率），与 Go 版一致暂未接入请求/采集路径，仅作为按需补充的客户端预留。

`application.yml` 中的 `${DB_HOST}` 等占位符由 spring-dotenv 从 `.env` 读取解析；真实环境变量优先级更高，生产环境可直接用环境变量注入，无需 `.env` 文件。

## 接口清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查（不包装，直接返回 `{status, database}`） |
| `POST` | `/api/v1/auth/login` | 微信登录，返回 `{token, user}` |
| `GET` | `/api/v1/user/profile` | 当前用户资料（需 `Authorization: Bearer <token>`） |
| `GET` | `/api/v1/stock/search` | 股票搜索，`q` 必填，`limit` 可选（默认 20） |
| `GET` | `/api/v1/stock/{code}/klines` | K 线，`scale` 必填（B 阶段仅支持 `240`/`1200`），`count` 可选（默认 100） |
| `GET` | `/api/v1/stock/{code}/quote` | 单只股票实时行情（新浪） |
| `GET` | `/api/v1/stock/quotes` | 批量实时行情，`codes` 必填，逗号分隔，最多 50 只 |

## 契约一致性

- 除 `/api/health` 外，所有接口响应统一为 `{code, msg, data}`，业务码在 `code` 字段（200 成功 / 400 参数错误 / 401 未认证 / 403 无权限 / 404 不存在 / 500 服务端错误）。
- HTTP 状态恒为 200（与 Go 版一致），错误信息由业务码表达，前端零改动即可切换。
- 与 Go 版 `backend/` 并存：Go 版仍可运行，迁移期间共用同一数据库，接口契约与字段命名（如 `prev_close`、`pct_change`）保持一致。

## C 阶段：板块 / 新闻 / 分钟线 / 数据采集

C 阶段在 B 阶段基础上新增：同花顺概念板块（板块列表 / 板块 K 线 / 成分股）、新浪新闻与巨潮公告、分钟级 K 线（5/15/30/60）、数据采集服务与定时任务。

### 新增接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/sector/boards?top=20` | 概念板块列表（库内优先，未命中回退同花顺；`top` 默认 20、最多 100，仅回退路径生效） |
| `GET` | `/api/v1/sector/board/{code}/klines?count=30` | 板块 K 线（同花顺；`count` 默认 30） |
| `GET` | `/api/v1/sector/members/{cid}` | 板块成分股（库内优先，回退同花顺；`cid` 为同花顺概念 ID） |
| `GET` | `/api/v1/stock/{code}/news?page=1` | 个股新闻（新浪；`page` 默认 1） |
| `GET` | `/api/v1/news/feed?page=1&size=20` | 通用新闻 feed（查库；`page` 默认 1，`size` 默认 20、最多 100；新浪源由 SinaFeedScheduler 每 5 分钟拉取落库） |
| `GET` | `/api/v1/stock/{code}/announcements?page=1&size=20` | 巨潮公告（`page` 默认 1，`size` 默认 20、最多 100） |

`GET /api/v1/stock/{code}/klines` 的 `scale` 参数在 C 阶段扩展：

- `240`（日）/ `1200`（周）：DB 读取，未命中回退新浪并异步回填（B 阶段已有）。
- `5` / `15` / `30` / `60`（分钟线）：直接请求新浪，返回 `{code, scale, klines, count}`，并按 scale 差异化缓存（5→30s / 15→60s / 30→120s / 60→180s）。

### 新增配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `app.collector.auto-full` | `false` | `false` 时 15:30 定时全量跳过、启动自检仅刷新股票信息/板块；`true` 时执行全量（含日K线）采集 |
| `app.collector.sample-size` | `20` | `CollectorService.runFull(sampleSize)` 的采样股票数上限（>0 且小于总数时仅处理前 N 只，0 表示全部） |
| `app.collector.startup-check` | `true` | 启动自检开关：`stock_info` / `concept_board` 表为空时自动采集；测试环境置 `false` 跳过 |
| `app.collector.run-sample-on-start` | `false` | 试运行模式：启动时执行一次小样本采集 `runFull(sample-size)`，用于上线前小样本验证采集链路；默认关闭 |

### 定时任务

| 时间 | 任务 |
| --- | --- |
| 工作日 9:00 | 刷新股票信息（股票列表 + 行业分类 → `stock_info`） |
| 工作日 9:05 | 刷新概念板块（板块列表 + 成分股 → `concept_board` / `concept_stock`） |
| 工作日 15:30 | 全量采集（含日K线），受 `app.collector.auto-full` 门控 |
| 启动自检 | `startup-check=true` 时，相关表为空则自动采集（是否全量由 `auto-full` 决定） |

### 集成验证脚本

`scripts/verify-b-phase.sh` 已扩展覆盖 C 阶段接口：概念板块、板块 K 线、分钟线（`?scale=60`）、个股新闻、新闻 feed、巨潮公告。启动方式：

```bash
bash scripts/verify-b-phase.sh
```

采集行为说明：试运行模式通过 `app.collector.run-sample-on-start=true` + `app.collector.sample-size=N` 触发，启动时执行一次 `CollectorService.runFull(N)` 小样本采集（默认关闭，不影响正常启动）；`sample-size` 亦可经 `CollectorService.runFull(sampleSize)` 在单元测试中验证（见 `CollectorServiceTest`）。定时 15:30 与启动自检的全量调用当前传入 `0`（全部股票）。`auto-full=false`（默认）时启动自检不会触发全量采集。

## 部署

`Dockerfile` + `scripts/deploy.sh` 提供镜像构建与容器运行。配置从 `backend-java/.env` 读取——构建不打包配置，运行时用 `docker run --env-file` 把 `.env` 注入为容器环境变量（spring-dotenv 读取；OS 环境变量优先于 `.env`）。不依赖 Go 版 `backend/`（M3 删除 Go 版后不受影响）。

```bash
# 前置：.env 存在（git 忽略，本地提供）
cp .env.example .env

# 只构建镜像（不运行）
bash scripts/deploy.sh

# 构建并本机运行容器（--network host，端口默认 18487，可用 PORT 覆盖）
bash scripts/deploy.sh --run

# 部署到服务器：构建 → 保存/拷贝镜像 → 服务器 docker load + docker run（参考 backend 的 CI 流程）
# 服务器同样用 .env 注入：docker run -d ... --env-file /apps/stock/backend-java/.env ...
```

采集试运行：部署后可用 `run-sample-on-start=true` 触发一次小样本采集验证链路（见上文 `app.collector.run-sample-on-start`）。

日志：`logback-spring.xml` 双通道输出——控制台（`docker logs` 可看）+ 文件落盘。文件按天滚动（`stock-backend.log` + 带日期的历史文件），只保留最近 3 天。容器内目录 `/apps/logs`，`deploy.sh --run` 默认挂载到宿主机 `/apps/stock/backend-java/logs`（可用 `LOG_DIR` 覆盖）；手动 `docker run` 时请同样挂载 `-v <宿主目录>:/apps/logs`，否则日志只进匿名卷，容器删除后难以找回。

> 与 Go 版 `backend/` 并存时注意端口：两者默认都监听 `18487`（host 网络），并存验证请用 `PORT` 给其中一方换端口。

### 监控接入（OpenTelemetry → SigNoz）

镜像**不打包** javaagent jar（避免 CI/服务器带宽消耗），部署时从宿主挂载 `opentelemetry-javaagent.jar` 并以覆盖 CMD 方式加载（`-javaagent`），自动采集 HTTP 请求 / JDBC / 定时任务 trace、JVM 指标与 logback 日志。

- **首次准备**（一次性，本机下好后 scp 到服务器，后续复用）：
  ```bash
  curl -L -o opentelemetry-javaagent.jar \
    https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/2.31.0/opentelemetry-javaagent-2.31.0.jar
  scp opentelemetry-javaagent.jar root@<服务器>:/apps/stock/backend-java/
  ```
  jar 缺失时部署脚本自动降级为无监控模式（业务不受影响）。
- **上报配置**：`.env` 中的 `OTEL_*` 变量（模板见 `.env.example`），部署时由 `docker run --env-file` 注入。
- **Endpoint 要点**：
  - 本机/开发：`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:18117`（`OTEL_EXPORTER_OTLP_PROTOCOL=grpc`）。
  - 线上经 Tailscale 回连本机：用**本机 Tailscale IP**（如 `http://100.90.180.33:18117`），**勿用 localhost**（容器内 localhost 不是宿主机）。
  - SigNoz 与业务同机/同 VPC 后：改为线上服务器内网或 Tailscale IP。
- **容错**：上报是异步的，SigNoz 不可达时业务不受影响（span 队列满后丢弃，不阻塞、不无限重试），适合监控暂不稳定的过渡期。
- **首次接入需重启容器**（JVM 启动参数变更），有数秒停机窗口；之后每次部署自动生效。
- **服务名**：SigNoz UI 的 Services 页以 `OTEL_SERVICE_NAME`（本项目 `stock-backend`）标识该服务。

## 部署前检查

切换线上流量前，请确认以下两点（涉及生产数据库，Java 侧启动不会自动校验）：

1. **`JWT_SECRET` 长度**：生产环境注入的 `JWT_SECRET` 必须 ≥ 32 字节。Go 版对短密钥宽松放行，而 Java 侧使用 jjwt 校验签名，密钥短于 32 字节会抛出 `WeakKeyException` 导致登录/鉴权失败。
2. **`news_feed` 唯一索引**：生产库 `news_feed` 表必须存在唯一索引 `(stock_code, title, published_at)`（与 Go 侧 `ON CONFLICT DO NOTHING` 的去重语义一致）。若缺失，重复采集会写入重复新闻，且 `ON CONFLICT DO NOTHING` 失去效果。可用以下语句校验/补齐：

   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uk_news_feed_dedup ON news_feed (stock_code, title, published_at);
   ```

另外，路由行为与 Go 版有一个有意的、低风险的差异：Java 侧未知路由返回 HTTP 404、方法不匹配返回 HTTP 405（Go 版对两者均返回 404）。该差异仅影响客户端错误路径，不影响正常契约，前端无需改动。

## 测试

```bash
mvn test
```
