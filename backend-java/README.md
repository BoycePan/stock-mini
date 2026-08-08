# backend-java

wx-app-stock 的 Java Spring Boot 后端，Go 版迁移（B 阶段）。

B 阶段已实现：健康检查、统一响应/异常、股票搜索、K 线（DB）、微信登录 + JWT + 个人资料、新浪实时行情。与 Go 版 `backend/` 并存运行，前端零改动。

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

## 测试

```bash
mvn test
```
