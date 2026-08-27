# 美股市值TOP100（纯前端直连东财）方案与验证

> 需求：首页美股指数区增加「市值TOP100」入口，查看美股市值前100个股；点击个股进入当日分时图。
> 落地：**纯前端**直连东方财富延迟行情（与首页行情同域，无需后端改动、无新增小程序合法域名）。

---

## 一、方案总览

### 1.1 交互

- 首页（`pages/global/index`）「美股指数」分组末尾新增入口卡「市值TOP100」（值显示「查看」，不显示涨跌徽标）；
- 点击入口卡 → 跳转 `packageQuote/pages/us-top100/index`（美股TOP100列表）；
- 列表按东财市值排名原样展示 100 行：排名 | 中文名+代码 | 最新价 | 涨跌幅 | 总市值（美元口径）；
- 点击某行 → 跳转既有分时页 `packageQuote/pages/minute/index?code=<裸代码>&name=<中文名>&mcode=<东财secid>`。

### 1.2 数据源

| 用途 | URL | 说明 |
| --- | --- | --- |
| 市值排名 | `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:105,m:106,m:107&fields=f12,f13,f14,f2,f3,f4,f20` | 美股三大市场（105=纳斯达克 / 106=纽交所 / 107=美交所）按总市值降序，`pz` 上限 100，单页即完整前100 |
| 个股分时 | `https://push2delay.eastmoney.com/api/qt/stock/trends2/get?secid=<secid>&fields1=f1..f14&fields2=f51,f53,f56,f58&ndays=1&iscr=0&iscca=0` | 复用既有 `api/minute.ts fetchEastmoneyMinute`，secid=`<f13>.<f12>`（如 `105.NVDA` / `106.BRK_B`） |
| 基础信息 | `https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=<secid>&fields=f5,f15,f16,f17,f18` | 复用既有 `fetchEastmoneyUlistQuote`，与分时同 secid |

> 与首页行情同域 `push2delay.eastmoney.com`（**延迟行情**，已在小程序合法域名内），全部链路实测可通（见下文「四、验证结果」）。

### 1.3 出参字段（clist/get，`fltt=2` 十进制）

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `f12` | 裸代码 | 如 NVDA / BRK_B（含特殊字符的代码东财用下划线，如 BRK_B） |
| `f13` | 市场号 | 105=纳斯达克 / 106=纽交所 / 107=美交所，用于拼 secid |
| `f14` | 中文名 | 如 英伟达 / 苹果；缺失时回退裸代码 |
| `f2` | 最新价 | 停牌/无数据返回 `"-"`，归一为 null |
| `f3` | 涨跌幅 % | 同上 |
| `f4` | 涨跌额 | 同上 |
| `f20` | 总市值 | 美股返回**美元**口径；无数据返回 `"-"`，归一为 null |

### 1.4 排序

列表拉取一次后**纯前端内存排序**（不重新请求），点「涨跌幅 / 总市值」列标题切换：

| 排序键 | 默认 | 交互 |
| --- | --- | --- |
| 总市值（cap） | 降序 | 点击切换 降序 ⇄ 升序 |
| 涨跌幅（pct） | 降序 | 点击切换 降序 ⇄ 升序；升序时涨幅最小的在前 |

- 排名（#）随当前排序重排为 1..100；
- 无数据行（杠杆产品 `--`）无论方向始终排最后；
- 排序图标用 tdesign `t-icon`（arrow-up / arrow-down），激活列高亮。

### 1.5 口径与限制（务必知悉）

- **原样按东财排名展示**：不做剔除过滤。东财口径下约 9 只杠杆/ETN 产品（DGP、QULL、MLPR 等 ETRACS 系列）会进入前100，部分行价格/涨跌幅为 `--`，与东财官方「美股总市值」排行一致；
- 行情为**延迟数据**（push2delay），价格可能落后实时数分钟；
- 市值单位：东财对美股返回**美元**（实测 NVDA ≈ $5.05万亿），列表按 `$x.xx万亿 / $x亿 / $x万` 展示；
- BRK_A / BRK_B 为同一家公司两个类别，会同时上榜，属正常。

### 1.6 分时页兼容（无需新建美股分时页）

既有分时页 `packageQuote/pages/minute/index` 原样复用，仅两处小改动：

1. `config/minute.ts`：`resolveMinuteSources` / `hasMinuteSources` 增加**美股 secid 模式兜底**
   （`EM_US_SECID_RE = /^(105|106|107)\.[A-Z][A-Z0-9._]*$/i`，命中即按 `{ em: secid }` 取数），
   无需为 100 只个股逐条登记 `MINUTE_SOURCES`；
2. `utils/minute-session.ts`：`resolveMinuteSession` 识别美股 secid → 美股时段轴
   （`us`，09:30–16:00 ET，锚定首点自动适配夏令时，与美指 `100.DJIA` 同一机制）。

分时页其余逻辑（多源兜底、ulist 基础信息、8s 静默刷新、十字光标、深浅主题、分享海报）全部复用。

## 二、代码结构（新增/改动文件）

| 文件 | 说明 |
| --- | --- |
| `api/us-stocks.ts` **新增** | `fetchUsTop100()`：clist/get 请求封装，失败降级空数组 |
| `utils/us-stocks.ts` **新增** | `parseUsTop100`（纯解析，`"-"` → null）+ `formatUsMarketCap`（美元市值格式化） |
| `types/quote.ts` **改** | 新增 `UsTopStock` / `UsMarketNumber` 类型 |
| `config/minute.ts` **改** | `EM_US_SECID_RE` + `resolveMinuteSources`/`hasMinuteSources` 美股 secid 兜底 |
| `utils/minute-session.ts` **改** | `resolveMinuteSession` 识别美股 secid → `'us'` |
| `utils/quote-pages.ts` **改** | `QuoteItem` 增加 `valueText` / `hideChange`；`metricOf` 透传；`QUOTE_ICONS` 增入口图标 |
| `api/market.ts` **改** | 「美股指数」分组末尾 push 入口卡（code=`us-top100`） |
| `utils/market-page-factory.ts` **改** | `onMetricTap` 拦截 `us-top100` → 跳列表页 |
| `config/tracking.ts` **改** | 新增 `us.top100.enter` / `us.top100.tap` 事件定义 |
| `packageQuote/pages/us-top100/index.*` **新增** | 列表页（ts/wxml/wxss/json），30s 静默刷新 + 下拉刷新 + 深浅主题 |
| `app.json` **改** | quote 分包注册 `pages/us-top100/index` |
| `tests/us-top100.test.ts` **新增** | 解析 / 市值格式化 / 分时源兜底 / 时段识别 |

## 三、验证结果（2026-08-27 实测）

| 项 | 结果 |
| --- | --- |
| clist/get（无 Referer，小程序同款请求头） | ✅ `total=13805`，前5：NVDA 5.05万亿 / AAPL 4.57万亿 / GOOGL / GOOG / MSFT，市值降序 |
| pz 上限 | ✅ 上限 100（pz=150/200 也只返回 100），pn 翻页续接（pn=2 首行 SCCO=第101名） |
| `f13` 市场号 | ✅ NVDA=105 / TSM=106（纽交所）/ DGP=107（美交所） |
| 特殊代码 | ✅ 伯克希尔为 `BRK_B`（下划线），secid=`106.BRK_B` |
| 分时 trends2 | ✅ `105.NVDA` / `106.JPM` / `106.BRK_B` 均返回当日分钟线（`preClose` + `trends`） |
| 基础信息 ulist | ✅ `106.BRK_B` 返回 f5/f15/f16/f17/f18（成交量/最高/最低/今开/昨收） |
| 非数字字段 | ✅ 停牌类行 `f2/f3/f4` 为 `"-"`，解析统一归一 null |

## 四、备注

- 后端 `/api/**` 零改动，无需写入 `docs/每日修改记录/`（该目录只记录后端对外 HTTP 接口契约变更）；
- 新增入口卡与列表页均遵守主题规范（浅/深双主题可读，见 AGENTS.md 色板）；
- 分享：列表页不开启分享（与分时页分享能力无关，分时页分享照旧可用）。
