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

密钥一律通过环境变量注入，不写入配置文件、不落盘。

```bash
export DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=... DB_PASSWORD=... \
       JWT_SECRET=... WECHAT_APP_ID=... WECHAT_APP_SECRET=...
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

服务默认监听 `18487` 端口（见 `application.yml` 的 `server.port`）。

## 配置说明

`application.yml` 中通过 `${...}` 占位符读取以下环境变量：

| 环境变量 | 用途 | 必填 |
| --- | --- | --- |
| `DB_HOST` | PostgreSQL 主机 | 是 |
| `DB_PORT` | PostgreSQL 端口 | 是 |
| `DB_NAME` | 数据库名 | 是 |
| `DB_USER` | 数据库用户 | 是 |
| `DB_PASSWORD` | 数据库密码 | 是 |
| `JWT_SECRET` | JWT 签名密钥 | 是 |
| `JWT_EXPIRE_HOURS` | JWT 有效期（小时） | 否，默认 `24` |
| `WECHAT_APP_ID` | 微信小程序 AppID | 是 |
| `WECHAT_APP_SECRET` | 微信小程序 AppSecret | 是 |

新浪行情限流参数（`app.sina`，位于 `application.yml`）：

- `rate-limit-seconds`：请求间隔限流（秒），默认 `1.0`
- `max-retries`：失败最大重试次数，默认 `3`
- `timeout-seconds`：请求超时（秒），默认 `30`
- `user-agent` / `referer`：请求新浪接口携带的 UA 与 Referer

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
| `GET` | `/api/v1/news/feed?q=A股&count=20` | 新闻聚合 feed（新浪；`q` 默认 `A股`，`count` 默认 20、最多 100） |
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

采集行为说明：当前没有管理触发端点；`sample-size` 通过 `CollectorService.runFull(sampleSize)` 生效（见 `CollectorServiceTest`），定时 15:30 与启动自检的全量调用当前传入 `0`（全部股票）。`auto-full=false`（默认）时启动自检不会触发全量采集。

## 测试

```bash
mvn test
```
