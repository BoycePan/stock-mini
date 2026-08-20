# 首页卡片当日分时图（纯前端直连）方案与验证

> 需求：**纯前端**，与首页行情**同源外部接口**，支持点击行情卡片查看**当日分时图**，并验证每个卡片都能拿到数据。
> 落地：卡片点击 → 跳转 `pages/minute/index`（分时查看页）→ 东财 → 腾讯 → Yahoo 多源兜底拉取。

---

## 一、方案总览

### 1.1 交互

- 全球 / 日韩 / 有色 三个行情页的**每张行情卡片**（指数 / 宏观资产 / 板块 / 个股 / 汇率 / 金属）
  显示「分时」角标，点击后 `wx.navigateTo` 跳转到 `pages/minute/index?code=<首页code>&name=<展示名>`；
- 金店金价（`GS-*`）、财经新闻等无分时标的**不显示角标**，点击提示「该指标暂无分时数据」；
- 分时页：App 头部（返回）+ 免责声明 + **基本信息卡片**（最新价 / 涨跌额 / 涨跌幅，以及今开 / 最高 / 最低 /
  均价 / 成交量 / 昨收，均由分时数据推算）+ 分时图（新组件 `components/minute-chart`）+ 数据来源标签 +
  加载 / 错误 / 空态，支持下拉刷新与深浅主题；
- 分时图 canvas：只绘制网格 / 昨收虚线 / 价格线 / 均价线 / 成交量柱 / 时间刻度，
  **不展示「当前价格」「昨收」常驻文字标签**；价格刻度在左侧留白内不遮挡图形；
  点击 / 拖动 canvas 显示同花顺式**十字光标** + 信息框（时间 / 价格 / 涨跌 / 均价 / 成交量）。

### 1.2 数据源（与首页同族外部接口）

| 源 | URL | 覆盖 | 说明 |
| --- | --- | --- | --- |
| 东财分时 | `https://push2delay.eastmoney.com/api/qt/stock/trends2/get?secid=<secid>&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0` | A股指数/个股、美股ETF/指数、板块(90.BKxxxx)、沪主连(113.xm)、上金所(118.)、COMEX/ICE(101./102./112.)、亚欧指数(100.) | **首选源**，覆盖绝大多数卡片；`data.preClose` 昨收 + `data.trends` 每行 `时间,现价,…,成交量,成交额,均价`（分钟级） |
| 腾讯分时 | `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=<code>` | A股、港股 | 兜底；`data.<code>.data.data` 每行 `[HHmm,现价,成交量,成交额]`，均价由累计额/累计量推算 |
| Yahoo 1分钟 | `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=1m` | 东财/腾讯分时均不覆盖的标的：KOSDAQ、VIX | 兜底源（**中国大陆访问被墙，仅作大陆外/兜底**）；`chart.result[0].timestamp` + `indicators.quote[0]`，昨收取 `meta.chartPreviousClose` |

> 取数优先级 **东财 → 腾讯 → Yahoo**，与首页「新浪 → 腾讯 → 东财」兜底链同一思路。
> 注：新浪仅有行情报价（`hq.sinajs.cn`），无公开分时接口；新浪 K 线接口也仅限 A 股，故未纳入。

### 1.3 代码结构（新增/改动文件）

| 文件 | 说明 |
| --- | --- |
| `config/minute.ts` **新增** | 首页卡片 code → `{em?, tc?, yahoo?, note?}` 映射表（唯一需要维护的地方）+ `hasMinuteSources` / `resolveMinuteSources` |
| `api/minute.ts` **新增** | 三个单接口封装（`fetchEastmoneyMinute` / `fetchTencentMinute` / `fetchYahooMinute`），失败降级 null，复用 `api/external.ts` 的 `requestExternal` |
| `utils/minute-parser.ts` **新增** | 三个源响应的纯解析函数（含均价推算、时间归一 `shortTime`） |
| `utils/minute.ts` **新增** | `fetchMinuteData(code)` 多源兜底链，返回 `{preClose, points, source, sourceLabel, note}` |
| `components/minute-chart/*` **新增** | 分时图组件（canvas 2d：价格线 + 均价线 + 昨收虚线 + 成交量柱，深浅主题） |
| `pages/minute/index.*` **新增** | 分时查看页（4 个文件，主题/刷新/加载态齐全） |
| `types/stock.ts` **改** | 新增 `MinutePoint` / `MinuteResult` 类型 |
| `types/market.ts` **改** | `MarketMetric` 增加 `code?: string` |
| `utils/quote-pages.ts` **改** | `metricOf` 透传 `code`（供点击时定位数据源） |
| `utils/market-page-factory.ts` **改** | ① store 绑定给每条 metric 加 `minuteAvailable`（驱动「分时」角标）② 新增 `onMetricTap`（无源提示 / 有源跳转） |
| `components/section-card/index.wxml/.wxss` **改** | 名称行追加「分时」虚线角标 |
| `pages/{global,asia,metals}/index.wxml` **改** | `market-page` 增加 `bind:metrictap="onMetricTap"` |
| `app.json` **改** | 注册 `pages/minute/index` |
| `tests/minute-parsers.test.ts` **新增** | 三个解析器单测 + 「首页全部卡片 code 均有分时源」覆盖性校验 |
| `scripts/verify-minute.ts` **新增** | 一键连通性验证脚本（见第三节） |

---

## 二、映射表（config/minute.ts 摘要）

| 页面 | 卡片 code | 东财 secid | 腾讯 code | Yahoo |
| --- | --- | --- | --- | --- |
| 全球·指数 | sh000001 / sz399001 / sz399006 / sh000688 | 1.000001 / 0.399001 / 0.399006 / 1.000688 | sh000001 / sz399001 / sz399006 / sh000688 | — |
| 全球·指数 | AVG（A股平均股价） | 47.800005（东财官方平均股价指数） | — | — |
| 全球·指数 | usDJI / usSPY / usQQQ | 100.DJIA / 107.SPY / 105.QQQ | — | — |
| 全球·宏观 | BRT / UDI / TLT | 112.B00Y / 100.UDI / 105.TLT | — | — |
| 全球·宏观 | GC / SI / HG / NG | 101.GC00Y / 101.SI00Y / 101.HG00Y / 102.NG00Y | — | — |
| 全球·宏观 | SOX | 251.SOX | — | — |
| 全球·宏观 | VIX | —（东财无此标的） | — | ^VIX |
| 全球·板块 | BK1134 … BK1016（24个） | 90.BKxxxx | — | — |
| 全球·板块（美股时段） | us-BK1134 … us-BK1016（24个） | 代理股分时均值合成（emProxies，见 2.1） | — | — |
| 日韩·指数 | KS11 / N225 / VNINDEX / SENSEX | 100.KS11 / 100.N225 / 100.VNINDEX / 100.SENSEX | — | — |
| 日韩·指数 | KQ11 | —（东财无） | — | ^KQ11 |
| 日韩·指数 | TPX | 1.513800（东证ETF代理） | sh513800 | — |
| 日韩·个股 | 005930…051910（韩8） | 177.005930 … 177.051910 | — | <code>.KS（兜底） |
| 日韩·个股 | 8035…7974（日8） | 176.8035 … 176.7974 | — | <code>.T（兜底） |
| 日韩·汇率 | USDKRW / USDJPY | 119.USDKRW / 119.USDJPY | — | KRW=X / JPY=X（兜底） |
| 日韩·汇率 | CNYKRW / CNYJPY / USDCNY | CNYJPY→133.CNHJPY、USDCNY→133.USDCNH（离岸）；CNYKRW→119.USDKRW ÷ 133.USDCNH（交叉合成） | — | CNYKRW=X / CNYJPY=X / CNY=X（兜底） |
| 有色·金银 | GOLD / SILVER | 113.aum 沪金主连 / 113.agm 沪银主连 | — | — |
| 有色·工业金属 | COPPER / ALUMINUM / ZINC / NICKEL / TIN | 113.cum / 113.alm / 113.znm / 113.nim / 113.snm | — | — |
| 有色·其他金属 | TUNGSTEN / MOLY / GERMANIUM / INDIUM / ANTIMONY | 1.600549 / 1.603993 / 0.002428 / 1.600961 / 1.601020 | sh600549 / sh603993 / sz002428 / sh600961 / sh601020 | — |

> 说明：
> - 金属「主连」= 东财 SHFE 连续合约（`<品种>m`），与首页国内价（`nf_*`）同口径，分时含夜盘；钨/钼/锗/铟/锑无现货/期货分时，取对应 A 股上市公司（与首页 tc 兜底同标的）。
> - 韩股/日股/汇率：东财分时（push2delay trends2）已实测覆盖（韩股市场号 **177**、日股 **176**、USDKRW/USDJPY **119**、离岸汇率 **133**，2026-08-20 起改为主源）；Yahoo 1分钟保留为兜底（大陆访问 Yahoo 被墙，见第三节）。KOSDAQ/VIX 东财无分时，仍仅 Yahoo。CNYKRW/CNYJPY/USDCNY 也改用东财系主源：USDCNY→133.USDCNH、CNYJPY→133.CNHJPY（离岸，与卡片在岸价略有价差，页面有 note 说明）；CNYKRW 东财无直盘，按「119.USDKRW ÷ 133.USDCNH」逐分钟交叉合成（合成序列无成交量/均价）。
> - 市场号更正：旧配置 `116.005930`（韩股）/ `151.8035`（日股）在 delay 主机返回 `data:null`，并非「东财不覆盖」，而是**市场号错误**（116=港股、151 非日股）；东财真实市场号为韩股 177、日股 176（`searchapi.eastmoney.com/api/suggest/get` 实测确认）。
> - TOPIX（东证指数）：东财 / 腾讯 / Yahoo 均无东证指数本身分时（Yahoo `^TPX` 实测为空），用「日本东证指数ETF南方(513800)」（跟踪 TOPIX，同东财/腾讯家族）代理，页面展示说明。
> - 金店金价（金投网零售价）**无分时**，不做角标、点击提示。
> - 外汇等无成交量的标的：东财 trends2 的均价字段恒为 `0.00000`，解析器将其归一为 `null`（不画均价线、不参与纵轴计算）；价格为 `0` 的分钟行直接跳过——否则 `|0-昨收|` 会把纵轴对称撑到异常范围（实测复现 -1.88 ~ 48.87）。

### 2.1 会话切换（卡片展示什么，点进去就看什么）

首页卡片的分时取数代码随会话切换，保证「卡片展示的数据口径」与「点进去的分时口径」一致：

| 场景 | 卡片展示 | 分时取数（mcode） |
| --- | --- | --- |
| 有色页 外盘时段 GOLD/SILVER/COPPER | COMEX 报价（美元/盎司、美元/磅） | `GOLD-US`/`SILVER-US`/`COPPER-US` → 东财 COMEX 分时（`101.GC00Y` 等，与全球页 GC/SI/HG 同一已验证源） |
| 有色页 国内盘（其余时段） | 沪主连 / A股个股 | 既有源（`113.xm` / `shxxxxxx`） |
| 有色页 外盘时段 铝/锌/镍/锡/钨 | 外盘报价（`hf_*`） | **无分时源**（`us-ALUMINUM` 等占位），点击给出提示 |
| 全球页 行业板块 A股时段 | 东财板块涨跌幅 | `90.BKxxxx`（东财板块分时） |
| 全球页 行业板块 美股时段 | 美股代理股涨跌幅均值 | `us-BKxxxx` → **代理股分时均值合成**（见下） |

> 机制：`api/market.ts` 按会话给卡片挂 `minuteCode`（分时取数专用代码，缺省等于展示 `code`）；
> `utils/market-page-factory.ts` 的 `onMetricTap` 以 `minuteCode ?? code` 判断是否有分时源并跳转
> （带 `mcode` 参数），无源时展示 `minuteUnavailableTip` 提示；分时页以 `mcode ?? code` 取数。
> 外盘无分时源的金属（`us-*` 无条目）**刻意不配置分时源**，避免「卡片展示外盘数据、
> 点进去却是沪主连/A股分时」的口径错位。

**美股时段板块 · 代理股分时均值合成**（`us-BKxxxx`，配置在 `config/minute.ts`）：

- 卡片展示的正是美股代理股涨跌幅均值，分时同样取代理股均值合成，口径完全一致；
- 实现：对每只代理（`emProxies`，即 `config/tabbar.ts` 的 `INDUSTRY_BOARDS[].proxies`，单一数据源）
  并发拉东财 trends2（`keepFullTime` 保留完整时间戳），各自归一化到昨收 100，按分钟取均值
  （跨零点 21:30 → 04:00 正确对齐；个别代理失败自动跳过），基准=昨收 100；
- 页面标注代理股中文名：东财返回中文名的直接用（英伟达/超威半导体…），返回英文名的
  （Coherent/Lumentum/Vertiv…）用 `config/minute.ts` 的 `US_PROXY_NAMES` 补充表，ETF 用简短中文名；
- 已有实测：24 个板块的 `us-BKxxxx` 全部可命中（`scripts/verify-minute.ts` 全量 0 失败）。

---

## 三、验证结果（每个卡片都能拿到数据）

### 3.1 一键复验脚本

```bash
cd front
node --import ./tests/register.mjs --experimental-strip-types scripts/verify-minute.ts          # 全量
node --import ./tests/register.mjs --experimental-strip-types scripts/verify-minute.ts sh000001  # 单个
```

脚本对 `config/minute.ts` 每个 code 按 东财 → 腾讯 → Yahoo 实测拉取，
输出 `OK <code> <源> <点数> 昨收=<值>`，全部命中退出码 0。**该脚本即「每个都能拿到数据」的可复现证据。**
全量实测结果：**75/75 个卡片 code 全部命中（0 失败）**，见下节。`

### 3.2 已实测证据（2026-08-19，脚本 / curl）

**A. 东财分时（push2delay trends2）实测返回（约 189~1100 点/日）：**
`1.000001`(241点)、`0.399001`(241)、`105.QQQ`(185)、`107.SPY`(189)、`105.TLT`(186)、
`251.SOX`(185)、`100.UDI`(1175，24h)、`112.B00Y`(985)、`101.GC00Y`(1105)、`101.SI00Y`(1105)、
`101.HG00Y`(1106)、`102.NG00Y`(1105)、`90.BK1134`(241)、`100.KS11`(391)、`100.N225`(331)、
`100.VNINDEX`(256)、`100.SENSEX`(376)、`118.AU9999`(274)、`113.aum/agm/cum/alm/znm/nim/snm`(216~556)、
`1.513800`(241)、`1.600549`(241)、`47.800005`（A股平均股价，东财官方平均股价指数）、
**`177.005930`…`177.051910`（韩股 8 只，各 391 点）、`176.8035`…`176.7974`（日股 8 只，各 331 点）、`119.USDKRW`(1440，24h)、`119.USDJPY`(1440，24h)**。
（旧配置 `116.005930`/`151.8035` 返回 `data:null` 是市场号错误，已更正为 177/176。）

**B. 腾讯分时（minute/query）实测返回：**
`sh000001`(242)、`sh600549`(267)、`hk00700`(332)。（外股返回单点，不采用。）

**C. Yahoo 1分钟（东财/腾讯分时不覆盖标的）实测返回：**
`^VIX`(543)、`^KQ11`(361)。（韩股/日股/USDKRW/USDJPY 已改走东财；CNYKRW/CNYJPY/USDCNY 已改走东财 119/133 或交叉合成，Yahoo 仅作大陆外兜底。）

**C2. 东财离岸汇率与交叉合成（2026-08-20 新增，大陆可直连）实测返回：**
`133.USDCNH`(1115，24h)、`133.CNHJPY`(1116，24h)；CNYKRW = `119.USDKRW`(1115) ÷ `133.USDCNH`(1115) 交叉合成约 1115 点（与新浪在岸 fx_scnykrw≈207 同量级、逐分钟吻合）。

**D. 单测覆盖性校验（tests/minute-parsers.test.ts）：**
全球页 / 日韩页 / 有色页**全部卡片 code 均有分时源**（金店金价除外），新增卡片漏配会直接测试失败。

---

## 四、上线注意事项

1. **微信 request 合法域名**（公众平台 → 开发管理 → 服务器域名）新增：
   - `https://web.ifzq.gtimg.cn`（腾讯分时）
   - `https://query1.finance.yahoo.com`（Yahoo 1分钟，若启用韩股/日股/汇率/VIX/KOSDAQ 卡片）
   东财分时走 `push2delay.eastmoney.com`，**已在首页合法域名内**，无需新增。
   开发调试可在微信开发者工具勾选「不校验合法域名」。
2. **中国大陆无法访问 Yahoo**（2021-11-01 起）——本方案已将韩股/日股/全部汇率分时改为主走东财
   （177/176/119/133，CNYKRW 为 119÷133 交叉合成），Yahoo 仅作兜底。若不想开放 Yahoo 域名：
   `config/minute.ts` 中删除 VIX/KQ11 等仍依赖 Yahoo 的条目即可，对应卡片不显示「分时」角标、
   点击提示暂无数据，其余卡片不受影响。
3. 金属（金银/工业金属）目前仅东财单源；东财分时接口故障时该卡片展示错误态可重试。
4. 免费接口的延迟/误差已在页面展示免责声明（与个股详情页一致）。
