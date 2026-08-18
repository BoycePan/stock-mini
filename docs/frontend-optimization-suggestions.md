# 前端优化与完善建议（对照 docs/tabbar-api.md）

> **范围**：`front/` 小程序前端（市场魔方助手）。
> **参考接口文档**：`docs/tabbar-api.md`。
> **核对基准**：2026-08-18 通读 `front/` 下 `api/`、`utils/`、`stores/`、`config/`、`pages/`、`components/`、`tests/` 全部源码后输出。

## 0. 背景说明（务必先读）

当前 `front/` 已不是 `docs/tabbar-api.md` 所描述的「还原版」，主要演进如下：

| 项 | 还原版（文档描述） | 当前 `front/` |
| --- | --- | --- |
| AI 行情页 | `pages/ai-data/ai-data`（标的池为空） | 已替换为财经页 `pages/finance/index`（走后端新闻接口） |
| 刷新时机 | onLoad + 下拉刷新（无定时器） | 增加 `MarketStore` + `startAutoRefresh` 每 10s 自动刷新 |
| 数据落地 | 各页面 JS 直接拼 URL | 收敛到 `api/market.ts`（编排）+ `api/quote.ts`（单接口）+ `utils/quote.ts`（多源聚合） |
| 标的配置 | 散落各页 JS | 集中在 `config/tabbar.ts` |

因此本文建议**针对当前 `front/` 实现**，按「先修 Bug，再谈优化」排列。

---

## 1. 正确性 / Bug（建议优先修）

### 1.1 生产环境 API 域名疑似拼写错误

- **位置**：`front/config/env.production.ts`
- **现象**：生产域名为 `https://wx_stock_interface.guyu.org.cn`（下划线），开发域名为 `https://wx-stock-interface.guyu.org.cn`（连字符）。
- **影响**：上线后所有后端接口（新闻 / 个股 / 板块 / 登录等）静默失败。
- **建议**：统一为连字符域名，并复核后端实际部署域名。

### 1.2 全球页「暂无行情数据」兜底判断失效

- **位置**：`front/api/market.ts` 第 119-121 行
  ```ts
  if (!indices.length && !macro.length && !sectors.length) {
    throw new Error('暂无行情数据')
  }
  ```
- **问题**：`indices` 恒为 4 条（`GLOBAL_INDICES.map`）、`macro` 恒为 8 条、`sectors` 恒为 24 条，即使三路外部接口**全部失败**，数组长度也不为 0，该判断永远不成立，是死代码。
- **影响**：断网 / 全失败时页面不报错、不显示空态，而是渲染 36 行 `—`。
- **建议**：改为按「有效报价数」判断（对齐 metals 页 `items.some(item => item.price !== null)` 的写法）。

### 1.3 `utils/request.ts` 未校验 HTTP 状态码与空 body

- **位置**：`front/utils/request.ts` 第 59-72 行
- **问题**：`success` 回调直接读 `body.code`。当后端返回 401/500、或 `response.data` 为 `undefined`/`null`（网关异常）时会 `TypeError`。
- **建议**：
  1. 先校验 `response.statusCode`（2xx 之外统一抛错，错误信息带状态码）；
  2. 判 `body` 是否存在后再取 `body.code`；
  3. 补 401 处理：token 过期时触发 `authStore.logout()` + 重新登录，而不是把 `msg` 直接抛给页面。

### 1.4 `aShareSecid` 大小写敏感

- **位置**：`front/utils/quote-consensus.ts` 第 27-30 行
  ```ts
  export function aShareSecid(code: string): string {
    const digits = code.replace(/^(sh|sz)/i, '')
    return `${code.startsWith('sz') ? '0' : '1'}.${digits}`
  }
  ```
- **问题**：`replace` 不区分大小写，但 `startsWith('sz')` 区分大小写。传入 `SZ000001` 会被误判为沪市 `1.000001`。
- **建议**：统一先 `code.toLowerCase()` 再判断市场前缀。

### 1.5 跳转小程序配置缺少本地持久化兜底

- **位置**：`front/api/quote.ts` 第 137-157 行
- **问题**：文档 5.3 / ⑤ 明确要求「60s 内存 + `wx.storage`（`jump_mp_last_ok_v1_app1`），失败回退缓存」。当前仅内存缓存，失败只回退默认 `visible:false`。
- **影响**：冷启动无网时永远拿不到上次成功的配置，跳转入口消失。
- **建议**：补 `wx.storage` 落盘；失败时先读缓存、再回退默认配置。

---

## 2. 性能角度

### 2.1 全球页宏观资产串行拉取，首屏慢

- **位置**：`front/api/market.ts` `getGlobalMarketPage` 中 8 个宏观资产用 `for` 循环逐个 `await fetchAccurate(..., { parallel: 2 })`。
- **问题**：最坏 8 轮串行（每轮最多 2 源 × 10s 超时）。
- **建议**：对 8 个资产做**项级并发限流**（`parallel = 2~3`，可自实现或引入轻量限流），与文档「`parallel=min(2,n)`」意图一致，但把项之间也并行起来。

### 2.2 固定 10s 自动刷新无市场时段感知

- **位置**：`front/utils/auto-refresh.ts`（`AUTO_REFRESH_INTERVAL = 10_000`）
- **问题**：
  1. `startAutoRefresh` 传 `silent:true`，`loadData` 折算成 `force:true`，每次都是全量重拉；
  2. 北京凌晨（A/美股都休市）仍每 10s 打 ①②③④ 外部接口。
- **建议**：结合 `getMarketSession()` 做**自适应轮询**——盘中 10s、盘前/盘后 30s、双休市 5min 或停刷；至少在外盘时段跳过 A 股板块请求。

### 2.3 财经页新闻也 10s 刷新，纯浪费

- **位置**：`front/pages/finance/index.ts` 复用 `startAutoRefresh`
- **问题**：每 10s 打一次后端 `news/feed`，新闻并非行情，无需高频。
- **建议**：财经页单独用更长间隔（如 60s）或仅下拉刷新 + `onShow`。

### 2.4 跨页 / 跨 key 无共享行情缓存

- **问题**：`hf_GC / hf_SI / hf_HG / hf_NG` 同时出现在 `MACRO_ASSETS`（全球页）与 `METALS`（有色页），切页时重复请求同一新浪 key。
- **建议**：抽一个**按 `key` 的短 TTL 行情缓存层**（复用 `market-session.ts` 的「TTL + in-flight 去重」模式），让 `fetchSinaQuotes / fetchTencentQuotes / fetchEastmoneyQuote` 统一走缓存。

### 2.5 `MarketStore.loadPage` 无 in-flight 去重

- **位置**：`front/stores/market.store.ts` 第 31-54 行
- **问题**：`onLoad`（非静默）+ `onShow`（静默）会并发触发同一 key 两次加载，重复请求。
- **建议**：照抄 `resolveGlobalMarketSession` 的 in-flight 去重范式。

### 2.6 缺整页级超时

- **问题**：单个 `wx.request` 有 timeout，但聚合链路（串行 + 兜底 + 共识）没有总超时，一个慢源能拖整页 20s+。
- **建议**：给 `getPage` 加总超时 / `Promise.race` 兜底。

---

## 3. 健壮性 / 容错角度

### 3.1 无重试 / 退避 / 熔断

- **现状**：失败 → 空数据 → 下一源兜底，但无单源重试与退避，也无连续失败熔断。
- **建议**：按源加一次短退避重试 + 失败计数熔断（如东财连续失败后暂时跳过）。

### 3.2 GBK 乱码只兜名称，不兜字段

- **现状**：`displayName` 仅对「名称」做乱码回退，`parseSinaQuote` 对其他字段未做清理。
- **建议**：在解析出口统一做「含非法字符即回退配置名/默认值」的清理，并确认 `wx.request` 对 GBK 响应的解码策略。

### 3.3 缺字段级快照校验（文档第 10 条明确要求）

- **现状**：东财 `ulist` 的 `f12/f13/f3`、`stock/get` 的 `f43/f57/f58/...` 为公开字段名，接口改版会**静默产出空数据**。
- **建议**：加「字段快照 / 样本断言」，解析到异常形状时打点告警（可先做成测试 fixture + 运行期 `console.warn`）。

### 3.4 `isStale` / `quoteTime` 算了没用

- **位置**：`front/utils/quote-parser.ts` `normalizeEastmoneyQuote`
- **现状**：已算好 `isStale`、`quoteTimestamp`，但页面从不消费。
- **建议**：把「数据陈旧」状态透出，行情超 4h 未更新时给角标 / 置灰，而不是显示「刚更新」的时间。

---

## 4. 架构 / 代码组织角度

### 4.1 存在一整套并行、未被使用的代码

- **发现**：
  - `front/api/global.ts`（`globalApi`，10 个后端全球接口）**全仓无引用**；
  - `front/utils/global-market.ts` 的 `buildGlobalPage / buildAsiaPage / buildMetalsPage` 仅被自己的测试引用；
  - `front/types/global.ts` 是另一套数据模型（`GlobalIndex / GlobalAsset / GlobalSector`）。
- **本质**：「后端聚合版」与「外部直连版」两条路线的残留。
- **影响**：后续维护会改错地方；`updatedLabel` 文案两处不一致（`数据更新时间` vs `已更新 · 数据每60秒刷新一次`）。
- **建议**：删除或明确废弃标记，统一走 `api/market.ts` + `quote-pages.ts`。

### 4.2 `api/market.ts` 偏巨石

- **现状**：443 行，四个页面的 `getXxxMarketPage` + 各页私有 `fetchXxx` 全挤在一个文件。
- **建议**：按页拆成 `market/global.ts`、`market/asia.ts`、`market/metals.ts`、`market/finance.ts`，只留一个 `getPage` 分发。

### 4.3 魔法数字散落

- **现状**：`10_000`(auto-refresh)、`30_000 / 60_000`(缓存 TTL)、`90min`(FRESH_MS)、汇率 `÷100`、`÷1000`、`parallel` 等散在多个文件。
- **建议**：集中到 `config/constants.ts`，并加注释对齐文档索引。

### 4.4 标的配置硬编码

- **现状**：`config/tabbar.ts` 的板块 / 个股 / 代理股全部硬编码；文档「AI 页标的池」也提示标的应从配置 / 缓存读取。
- **建议**：把标的清单做成**远程可下发配置**（带本地缓存 + 版本号），业务改标的无需发版。

### 4.5 `formatNumber` 内联重复

- **位置**：`front/utils/global-market.ts` 内又抄了一份 `formatNumber`（注释说是规避 `.ts` 后缀导入问题）。
- **建议**：若删除 `global-market.ts` 则顺带解决；否则统一走 `formatter.ts`。

---

## 5. 数据一致性 / 缓存角度

### 5.1 `MarketStore` 缓存无 TTL / 无 stale-while-revalidate

- **现状**：要么命中缓存永不更新，要么 force 全量重拉。
- **建议**：改成「TTL + 后台刷新」：命中且未过期直接返回；过期则先用旧数据渲染、后台更新（对 `silent` 尤其友好），并记录真实 `lastFetchedAt`。

### 5.2 `updatedLabel` 用设备本地时间，而非行情时间

- **位置**：`front/utils/quote-pages.ts` `buildQuoteXxxPage` 里 `formatDateTime()`。
- **问题**：取手机本地时钟，海外用户会看到错误时间。
- **建议**：优先用行情源时间戳（`quoteTime / quoteTimestamp`），缺失再回退本地，并标注时区。

### 5.3 会话缓存粒度可再细化

- **现状**：全球页实时会话 30s 缓存合理；有色页只有纯时钟（无探测），与文档 5.2 的 `resolveNonferrousMarketSession`（并发 4 路探测）有出入。
- **建议**：当前更省流量但无法感知节假日 / 临时休市；可按需补「节假日表」而非实时探测。

---

## 6. 体验 / UX 角度

### 6.1 Tab 切换用 `wx.redirectTo` 重建页面

- **位置**：`front/components/bottom-tabbar` + 各页 `onTabChange`。
- **问题**：每次切 tab 销毁旧页、重建新页：丢滚动位置、`section-card` 跳动动画基线（WeakMap）被清空。
- **建议**：改**原生 `tabBar`**（`app.json` 配 5 页 + `wx.switchTab`），或至少保留页面状态（自定义 tab 常驻 + 隐藏切换）。注意：若用原生 tabBar，5 页的 `navigationStyle:custom` 与自定义 header/tabbar 需统一处理。

### 6.2 静默刷新失败完全无感知

- **现状**：`loadData({silent:true})` 失败只 `console.warn`。
- **建议**：页面保留「上次成功时间」，长时间失败后给轻量角标 / 置灰，而非永远显示旧数据像没事一样。

### 6.3 空态 / 错误态覆盖不全（连带 1.2）

- **现状**：全球页兜底判断失效导致空态不出现。
- **建议**：修掉后统一走 `empty-state` / `loading-state` 组件，并确保 finance / asia / metals 的失败分支都真正能命中。

### 6.4 深色主题全量审计（AGENTS.md 强制）

- **已核对**：4 个行情页 + `section-card` / `bottom-tabbar` 基本合规。
- **待走查**：`stock-detail`、`search`、`news`、`news-detail`、`sector-detail`、`legal`、`kline-chart`（Canvas 配色）需逐一在深色下检查，重点看 K 线图坐标 / 网格 / 文字颜色是否随 `theme` 切换。

---

## 7. 安全角度

### 7.1 跳转配置校验已到位，建议再补

- **已做**：`appId` 正则（`^wx[0-9a-fA-F]{16}$`）+ `envVersion` 白名单。
- **建议**：
  1. `path` 校验（拒绝含 `://`、`javascript:` 等，防止非预期跳转）；
  2. 配置域名 `douyin.aaaa5.cn` 建议走自有后端代理 / 加签名，避免第三方配置被篡改后诱导跳转。

### 7.2 鉴权细节

- **现状**：`withAuth` 头正确；`loginWaiter` 门闩只对「后端请求」生效，外部直连请求按设计绕过（符合文档预期）。
- **建议**：补 401 自动登出 / 重登（见 1.3）。

---

## 8. 工程质量 / 可观测性角度

### 8.1 测试覆盖集中在纯函数，编排层零测试

- **现状**：`quote-parsers.test.ts`、`quote-consensus`、`market-clock` 覆盖很好，但 `api/market.ts`（串行 / 兜底 / 共识 / 板块均值编排）无测试。
- **建议**：把 `getGlobalMarketPage` 等做成「注入 fetcher 的纯编排函数」，用 fixture 覆盖「全失败」「部分源失败」「板块均值」「汇率异常涨跌幅」等分支。

### 8.2 建议补请求层测试

- **建议**：`request.ts` / `external.ts` 用 mock `wx.request` 覆盖：状态码异常、空 body、超时、Referer 头正确性。

### 8.3 加埋点 / 可观测

- **现状**：只有 `console.warn`。
- **建议**：按源统计「命中率 / 降级次数 / 共识冲突 / 请求耗时」，尽早发现上游接口漂移（文档最担心的问题），并验证多源兜底是否真的在兜。

### 8.4 CI 未接格式检查

- **现状**：`package.json` 已有 `lint` / `type-check` / `test` / `format:check`。
- **建议**：CI 串上 `format:check + lint + type-check + test`，防止提交破坏。

---

## 9. 实施优先级

| 优先级 | 事项 | 工作量 |
| --- | --- | --- |
| P0 | 修 `env.production.ts` 域名、全球页兜底判断、`request.ts` 状态码 / 空 body | 小 |
| P0 | 跳转配置补 `wx.storage` 持久化兜底 | 小 |
| P1 | 宏观资产项级并行 + `loadPage` in-flight 去重 + 自适应轮询 | 中 |
| P1 | 抽「按 key 的短 TTL 行情缓存层」，消除跨页重复请求 | 中 |
| P1 | 删 / 标废弃 `api/global.ts`、`utils/global-market.ts`、`types/global.ts` | 小 |
| P2 | 拆 `api/market.ts`、集中魔法数字、标的远程配置 | 中 |
| P2 | 透出 `isStale`、用行情时间替代本地时间、深色主题全量审计 | 中 |
| P3 | 编排层可测试化、埋点、CI 接 format:check | 中 |

---

## 附录：主要问题 → 文件索引

| 问题 | 文件 |
| --- | --- |
| 生产域名下划线 | `front/config/env.production.ts` |
| 全球页兜底判断失效 | `front/api/market.ts` |
| 请求层状态码 / 空 body | `front/utils/request.ts` |
| `aShareSecid` 大小写 | `front/utils/quote-consensus.ts` |
| 跳转配置无持久化 | `front/api/quote.ts` |
| 固定 10s 自动刷新 | `front/utils/auto-refresh.ts` |
| 缓存无 TTL / 无去重 | `front/stores/market.store.ts` |
| 死代码（后端聚合版） | `front/api/global.ts`、`front/utils/global-market.ts`、`front/types/global.ts` |
| Tab 切换重建页面 | `front/components/bottom-tabbar` + 各页 `onTabChange` |
