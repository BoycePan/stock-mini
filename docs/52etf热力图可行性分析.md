# 52etf.site「大盘云图」小程序复刻可行性分析报告

> 生成时间：2026-08-10
> 分析对象：https://52etf.site（爱盯盘 · A股大盘云图热力图）
> 目标：评估在小程序（front/）中复刻同款页面，并确认「直接使用其数据源」的可行性
> 说明：本报告仅做分析与方案设计，未改动任何代码

---

## 0. 结论先行（TL;DR）

| 问题 | 结论 |
|------|------|
| 这个页面能不能在小程序做？ | **可以**，技术完全可行，且有现成基础（Canvas 组件、外部直连层、板块/个股页） |
| 能不能直接调 52etf 的 API？ | **不能**。`/api/**` 有反爬（403/400），robots.txt 明确 `Disallow: /api/`，属对方私有接口 |
| 52etf 是不是也调用了 dq.10jqka.com.cn（同花顺）？ | 前端**仅 preconnect 预连接，无实际调用**（23 个 JS chunk 全文检索确认）；同花顺疑似只在其服务端用于行业分类。同花顺真实接口（d.10jqka.com.cn）实测可用但 JSONP+GBK+反爬，不适合小程序直连 |
| 不依赖 52etf，能否拿到同款数据？ | **能**。52etf 的底层数据源（东方财富 push2delay）公开可直连，**实测全部打通** |
| 推荐架构 | 结构数据走后端代理缓存（一次请求拿全量树），实时价格前端直连批量接口；纯前端直连可作为过渡方案 |
| 工作量 | MVP 约 4~6 人日；完整版（复盘/截图分享/多市场）约 8~10 人日 |
| 最大风险 | ①小程序 request 域名白名单 ②东财接口无 SLA 与商用授权 ③前端 56 页并发拉全量 A 股的开销 |

> ✅ **实施状态（2026-08-10）**：MVP 已按「方案 A 前端直连」落地为 `packageTreemap` 分包
> （页面 + treemap-chart Canvas 组件 + 两段式数据层），入口在「设置 → 大盘云图」，
> 不影响现有业务（仅 app.json 追加分包声明 + 设置页加一行入口）。详见第 8 节。

---

## 1. 52etf.site 是什么

**站点身份**：爱盯盘（52etf.site），一个免费的 A 股大盘云图（Treemap 热力图）盯盘工具。

**技术栈**：Nuxt 3（Vue）前端 + Canvas 渲染 + d3 treemap 布局 + 多层预渲染缓存。

**页面核心功能**（从 HTML/JS/payload 逆向确认）：

| 功能 | 实现细节（源码证据） |
|------|---------------------|
| 热力图主体 | `<canvas id="treemap">`，面积=市值（f20 总市值 / f21 流通市值），颜色=涨跌幅，红跌绿涨 |
| 分级钻取 | `zoomLevels: [10, 13, 16, 19]` 等多级缩放，行业板块 → 概念板块 → 个股 |
| 市场切换 | selectMarket：沪深/上证/深证/创业板/科创板/港股大盘/恒生科技等 |
| 排序维度 | selectName：当日涨跌幅、昨日涨跌幅、近一周、近一月、今年来、近一年 |
| 历史复盘 | selectTime：09:30~15:00 每半小时一个快照点（键盘左右方向键切换） |
| 实时刷新 | 交易时段内每 8 秒更新一次（页面提示「每8秒更新数据」） |
| 个股详情 | 悬停显示代码/名称/最新价/涨跌幅，双击跳雪球 K 线 |
| 截图分享 | 全屏盘面导出 PNG |
| 行情性质 | **延迟行情（非 Level-2）**，数据来自东方财富、同花顺、金融界 |

---

## 2. 数据源深度分析

### 2.1 52etf 自有 API —— ❌ 不可用

从 JS bundle（TreeMap-D2wGgH9n.js）逆向出的接口：

| 接口 | 参数 | 实测结果 |
|------|------|----------|
| `/api/market/treemap?market=sh&v=1` | market: sh/sz/hk/all 等 | **403**（即使带 UA/Referer/自定义头 `x-52etf-site-request: 1` 仍 403/400） |
| `/api/market/stocklist?selectStr=&market=sh` | 可选 `&time=HHMM` 复盘 | **403** |
| `robots.txt` | — | **`Disallow: /api/`**（明确禁止抓取） |

**结论**：52etf 的 `/api/**` 是私有接口，反爬 + robots 双重禁止，**技术上和合规上都不能直接使用**。他们服务端把东财/同花顺/金融界数据聚合、清洗后包装成自己的树结构，这部分是他们的核心资产。

### 2.2 底层公开数据源 —— ✅ 实测全部打通（东方财富 push2delay）

52etf 页面 HTML 里 `preconnect` 声明了 `push2delay.eastmoney.com` 和 `dq.10jqka.com.cn`，JS 里直连了 `push2delay.eastmoney.com` 和 `gateway.jrj.com`。逐项实测：

#### ① 行业板块列表（热力图第一层）

```
GET https://push2delay.eastmoney.com/api/qt/clist/get
    ?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3
    &fs=m:90+t:2                                   ← 东财行业板块
    &fields=f2,f3,f12,f14,f20,f104,f105,f128,f140
```

**实测返回**：`total=496` 个行业板块，每条含：
`f2` 板块点位 / `f3` 涨跌幅 / `f12` 板块代码(BKxxxx) / `f14` 板块名 / `f20` 总市值 / `f104` 上涨家数 / `f105` 下跌家数 / `f128` 领涨股名 / `f140` 领涨股代码。

#### ② 全 A 股列表（热力图叶子节点，一次拉全）

```
GET https://push2delay.eastmoney.com/api/qt/clist/get
    ?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3
    &fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23          ← 沪主板+创业板+深主板+科创板
    &fields=f2,f3,f5,f6,f8,f12,f14,f20,f21,f100,f103
```

**实测返回**：`total=5554` 只 A 股，每条含：
`f2` 最新价 / `f3` 涨跌幅 / `f5` 成交量 / `f6` 成交额 / `f8` 换手率 / `f12` 代码 / `f14` 名称 / `f20` 总市值 / `f21` **流通市值** / `f100` **所属行业** / `f103` 所属概念。

> **关键发现**：`f100` 字段直接带每只股票的行业归属，**一次遍历即可在本地构建「行业 → 个股」的完整热力图树**，无需逐个板块拉成分股。

#### ③ 板块成分股（可选，用于按板块精确拉取）

```
GET https://push2delay.eastmoney.com/api/qt/clist/get
    ?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3
    &fs=b:BK0475+f:!50                              ← 板块代码
    &fields=f2,f3,f5,f6,f8,f12,f14,f20
```

实测正常返回成分股列表。

#### ④ 指数行情（顶栏大盘状态）

```
GET https://push2delay.eastmoney.com/api/qt/ulist.np/get
    ?fltt=2&fields=f2,f3,f4,f12,f14
    &secids=1.000001,0.399001,0.399006,1.000688,100.HSI
```

实测返回上证指数/深证成指/创业板指/科创50/恒生指数，连港股 `100.HSI` 都支持。

#### ⑤ 实时价格合并（8 秒轮询用，全 A 股批量）

52etf 的做法（JS 逆向）：遍历树收集叶子 `code`，映射为 secid（`.SH`→`1.600519`，其他→`0.000001`）后一次请求：

```
GET https://push2delay.eastmoney.com/api/qt/ulist.np/get
    ?fltt=2&fields=f2,f3,f12&secids=1.600519,0.000001,...
```

返回 `data.diff[]`：`f2` 最新价 / `f3` 涨跌幅 / `f12` 代码。**实测可用**。

### 2.3 同花顺 dq.10jqka.com.cn —— ⚠️ 52etf 前端仅 preconnect，未实际调用；真实同花顺接口可作备选源

**逆向结论**：52etf 首页 HTML 与 vendor bundle 中出现了 `dq.10jqka.com.cn`，但**只出现在 `<link rel="dns-prefetch">` / `<link rel="preconnect">` 声明里**（浏览器提前建立连接池的优化手段）。对全部 23 个 JS chunk 全文搜索确认：

- 没有任何 `fetch`/`useFetch`/`$fetch`/`XMLHttpRequest` 直接调用 `dq.10jqka.com.cn`
- `TreeMap` 组件里的 `thsData` 只是**组件内部状态名**（涨跌家数 up/down/flat、成交额 turnover），与同花顺无关
- 页面真正的实时数据链路只有三条：自有 `/api/`（服务端聚合）、`gateway.jrj.com/quot-dpyt/hq`（金融界 8s 主源）、`push2delay.eastmoney.com`（东财兜底）
- 52etf 的 llms.txt 自称「行业分类基于申万/同花顺行业板块标准」——同花顺大概率在**其服务端**被用于行业分类构建（前端不可见），而非浏览器直连

**为什么 preconnect 同花顺**：52etf 可能原本计划直连同花顺、或服务端会重定向到同花顺资源，浏览器预先建连以降低首屏延迟。对本项目无借鉴意义。

**同花顺真实接口实测（可作备选数据源）**：

| 接口 | URL | 实测 |
|------|-----|------|
| 实时行情(JSONP) | `https://d.10jqka.com.cn/v2/realhead/hs_600519/last.js` | ✅ 200，JSONP 格式 `quotebridge_v2_realhead_hs_600519_last({...})`，含最新价/涨跌/五档/量额等字段 |
| 日K线(JSONP) | `https://d.10jqka.com.cn/v6/line/hs_600519/01/last.js` | ✅ 200，`quotebridge_v6_line_...({year:{...},total,data:"date,open,high,low,close,volume,amount;..."})` |
| 行业板块HTML | `http://q.10jqka.com.cn/thshy/` | ✅ 200，GBK 编码 HTML（同花顺行业分类） |

**注意**：同花顺接口是 JSONP + GBK + 反爬（需 TLS 指纹模拟，参见 `EXTERNAL_API_ANALYSIS.md` 第 4 节，Python 侧用 `curl_cffi` 模拟 Chrome TLS 指纹才能稳定访问），**不适合小程序端直连**；若要用同花顺行业分类，只适合在服务端（方案 B）抓取。

### 2.4 金融界 gateway.jrj.com —— ❌ 放弃

```
GET https://gateway.jrj.com/quot-dpyt/hq?column=chg
```

52etf 用它做 8 秒实时主源。但直接请求 **404**（可能需要浏览器环境/特定签名），且它只是 52etf 的一个冗余源，东财已完全覆盖需求，**不必依赖**。

### 2.5 关键约束：分页上限

实测东财 clist 单页 `pz` 最大 **100**（pz=500/6000 均被截断为 100）。全 A 股 5554 只需 **56 页**即可拉全。ulist 批量接口单次可传大量 secid（52etf 一次合并全部叶子）。

---

## 3. 小程序落地方案

### 3.1 三种架构对比

| 方案 | 数据链路 | 优点 | 缺点 | 适用 |
|------|----------|------|------|------|
| **A. 前端直连东财** | wx.request → push2delay.eastmoney.com | 零后端改动、最快落地 | ①域名需加入小程序 request 合法域名白名单 ②前端并发拉 56 页较重 ③风控风险 ④热力图结构每次都要前端组装 | 开发版/体验版、低并发、快速验证 |
| **B. 后端代理聚合（推荐）** | 前端 → 自家后端 `/api/v1/treemap` → 东财（服务端拉 56 页 + 聚合缓存） | 一次请求拿全量树、可服务端缓存 5 分钟、可限流、域名白名单已配、结构组装在后端 | **需要新增后端接口**（AGENTS.md 限制下需用户批准） | 正式上线、稳定生产 |
| **C. 混合** | 结构数据走后端缓存；实时价格前端直连 ulist | 兼顾实时性与请求量 | 前端仍需配东财域名 | 折中选择 |

> ⚠️ 微信小程序生产环境要求：wx.request 的 URL 域名必须加入小程序后台的 **request 合法域名**，且域名需 **ICP 备案 + HTTPS**。`push2delay.eastmoney.com` 是东方财富的公开行情域名（HTTPS 正常、已备案），理论上可配置，但**域名备案主体需与小程序主体一致或经授权**——需在微信公众平台后台实际验证（若校验不通过则必须走方案 B 后端代理）。

### 3.2 推荐实现路径（方案 B，前端先行）

**阶段一：前端直连原型（方案 A，不动后端）**
1. 新建 `front/api/treemap.ts`：封装东财 clist/ulist 四个接口（复用 `utils/requestExternal` 直连层，已有新浪/腾讯先例）
2. 新建 `front/components/treemap-chart/`：Canvas 2D 热力图组件
   - d3 treemap 布局算法按市值（f21 流通市值）计算方块面积——纯 JS 可移植，不引 d3 也可手写 squarified treemap
   - 红跌绿涨配色 + 深浅映射涨跌幅（52etf 用 38 级渐变，可简化到 10~16 级）
   - 分层预渲染缓存（同 52etf 的 `preRenderedCanvases` 思路）：行业层、概念层、个股层各预渲染一张离屏 canvas，缩放钻取时切换，避免每帧重绘 5000+ 方块
   - 点击命中检测：按 canvas 坐标反查方块（存布局结果数组做二分/空间索引）
3. 新建 `front/pages/treemap/index`（或挂在 global 页作为入口）：
   - 首屏：拉板块列表（496 个，1 页）+ 全 A 股（56 页并行，控制并发 8~10）→ 按 f100 分组构建树
   - 顶部状态条：上证/深证/创业板/科创50/恒指（ulist 一次请求）
   - 8 秒轮询：只调 ulist 批量接口刷新价格与颜色，结构不重建
   - 点击个股 → 跳转现有 `pages/stock-detail`（已存在）；点击板块 → 钻取或跳 `pages/sector-detail`
   - **双主题兼容**（AGENTS.md 强制）：背景/文字随主题，涨跌色固定；Canvas 绘制配色按 theme 切换

**阶段二：后端代理固化（需用户批准改 backend-java）**
- 后端新增 `GET /api/v1/treemap?market=all`：服务端拉 56 页 → 按 f100 聚合成树 → 内存缓存 5 分钟（参考 52etf 的 TREE_STRUCTURE 缓存策略）→ 返回 `{ timestamp, tree }`
- 前端 `front/api/treemap.ts` 切到后端路径；实时价格仍走东财 ulist 直连
- 按 AGENTS.md 要求，接口变更需记录到 `docs/每日修改记录/YYYY-MM-DD.md`

### 3.3 数据流时序（方案 B）

```
首屏：
  前端 ── GET /api/v1/treemap ──▶ 后端（56页并发拉东财 clist → f100 分组 → 树）
      ◀── { tree: 板块→个股 层级, timestamp } ──（后端缓存 5min）

轮询（8s）：
  前端 ── GET push2delay ulist.np/get?secids=<全树叶子> ──▶ 东财
      ◀── { code → price | chg% } ── 仅更新颜色/数字，不重建树

复盘（可选）：
  前端 ── GET /api/v1/treemap?market=all&time=0930 ──▶ 后端（按历史快照）
```

### 3.4 页面结构建议

```
┌──────────────────────────────┐
│ 顶栏：上证 深证 创业板 科创50 恒指 │  ← ulist 一次请求
├──────────────────────────────┤
│                              │
│   Canvas 热力图（treemap）      │
│   面积=流通市值 颜色=涨跌幅       │
│   行业→个股 点击钻取             │
│                              │
├──────────────────────────────┤
│ 底部：涨跌家数/成交额统计条        │  ← 板块列表 f104/f105/f6 聚合
└──────────────────────────────┘
```

---

## 4. 合规与风险

| 风险 | 等级 | 说明与对策 |
|------|------|-----------|
| 东财接口无 SLA | 中 | 公开接口随时可能改字段/加风控；需做超时、重试、失败降级（缓存旧数据+提示延迟） |
| 东财数据商用授权 | 中 | 东财用户协议对批量/商用抓取有限制；个人与学习用途风险低，商用前建议确认授权或换官方数据商（如聚宽/Tushare 等有 API 授权） |
| 小程序 request 域名白名单 | 高 | 直连东财域名需后台配置且通过备案主体校验；不通过则必须后端代理（方案 B） |
| 前端拉全量 56 页 | 中 | 首屏并发控制 + 服务端缓存（B 方案）后前端仅 1 次请求 |
| 数据实时性标注 | 中 | 页面需明确「延迟行情，仅供参考，不构成投资建议」（与现有 disclaimer-footer 一致） |
| 复盘模式 | 低 | 52etf 的复盘依赖其私有快照接口，无法复刻其历史；可改为仅保留当日分时快照或砍掉 |

---

## 5. 工作量估算

| 模块 | 内容 | 估时 |
|------|------|------|
| 数据层 | `front/api/treemap.ts` + 解析/分组/树构建 | 0.5~1 人日 |
| Canvas 组件 | 布局算法 + 分层预渲染 + 命中检测 + 双主题 | 2~3 人日 |
| 页面 | treemap 页 + 顶栏状态 + 8s 轮询 + 跳转对接 | 1~2 人日 |
| 性能与兼容 | 深色主题验收、真机性能、并发控制 | 1 人日 |
| 复盘/截图分享（可选） | 快照存储 + 海报（复用 share-poster） | 2 人日 |
| **MVP 合计** | — | **4~6 人日** |
| **完整版合计** | — | **8~10 人日** |

---

## 6. 需要用户决策的事项

1. **数据链路选型**：先做纯前端直连（A）验证，还是直接规划后端代理（B）？→ 决定是否要动 backend-java
2. **小程序后台域名校验**：`push2delay.eastmoney.com` 是否已/能加入 request 合法域名？需在微信公众平台确认备案主体校验
3. **功能范围**：MVP（热力图+钻取+8s刷新）还是完整版（+复盘+截图分享+多市场切换）
4. **入口位置**：挂在现有「全球」Tab 内作为子页面，还是新增独立入口

---

## 7. 附：实测接口速查表（均已验证可用）

| 用途 | URL |
|------|-----|
| 行业板块列表 | `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f12,f14,f20,f104,f105,f128,f140` |
| 全 A 股（含行业/市值） | `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f6,f8,f12,f14,f20,f21,f100,f103` |
| 板块成分股 | `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:BK0475+f:!50&fields=f2,f3,f12,f14,f20,f21` |
| 指数批量 | `https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=1.000001,0.399001,0.399006,1.000688,100.HSI` |
| 个股价格批量（8s 轮询） | `https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12&secids=1.600519,0.000001,...` |

---

## 8. 实施记录（2026-08-10 已完成 MVP）

**落地形态**：新增 `packageTreemap` 分包（方案 A 前端直连东财，零后端改动），入口「设置 → 更多 → 大盘云图」。

### 新增文件

| 文件 | 职责 |
|------|------|
| `front/packageTreemap/pages/treemap/index.{ts,wxml,wxss,json}` | 热力图页面：顶栏指数 + 层级导航 + 统计条 + 8s 轮询 |
| `front/packageTreemap/components/treemap-chart/index.{ts,wxml,wxss,json}` | Canvas 2d 热力图组件：布局渲染 + 点击命中 + 双主题 |
| `front/packageTreemap/utils/treemap-layout.ts` | Squarified treemap 布局算法（纯 TS，无 d3 依赖） |
| `front/packageTreemap/utils/treemap-data.ts` | 东财 clist/ulist 两段式数据层 + 5 分钟板块缓存 |
| `front/packageTreemap/types/treemap.ts` | 类型定义 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `front/app.json` | 追加 `packageTreemap` 分包声明（1 个页面） |
| `front/pages/settings/index.{ts,wxml}` | 「更多」分组加「大盘云图」入口行（navigateTo） |
| `front/tests/subpackage-audit.mjs` | 把 packageTreemap 纳入 usingComponents / 导航 / 跨包引用扫描 |

### 关键设计决策

1. **两段式加载，不做 56 页全量拉取**：行业层拉板块列表（`fs=m:90+t:2`，496 个，5 页并行）；
   点击板块再拉成分股（`fs=b:BKxxxx`，大板块 6 页并行，实测半导体 524 只全覆盖）。
2. **8s 轮询只刷当前层**：行业层重拉板块列表（走 5 分钟缓存校验），个股层重拉成分股；
   页面 onHide 暂停、onShow 恢复；指数随轮询一起刷新。
3. **面积=市值、颜色=涨跌幅**：板块层面积用板块总市值（f20），个股层面积用流通市值（f21）；
   红涨绿跌（#eb514d/#20a66a），深浅随 |pct| 10 级渐变，平盘中性底色。
4. **双主题兼容**：Canvas 内 `isDark` 分支切换底色/文字；页面 wxss 按 AGENTS.md 色板
   提供 `.page.theme-dark` 覆盖。
5. **命中检测**：canvas touch 事件 `changedTouches[0]`（相对 canvas 的 x/y）+ 布局矩形反查。
6. **跳转**：板块层点击 → 钻取成分股层；个股层点击 → `wx.navigateTo` 现有
   `packageQuote/pages/stock-detail/index?code=xxx`（复用现有个股页，不新建）。
7. **稳健性**：所有请求失败降级为空数据不抛错（页面显示错误卡 + 重试按钮）；
   无数据板块跳过；`fetchClistAll` 按 total 分页补齐。

### 验收情况

- ✅ `tsc --noEmit` 通过（strict + noUncheckedIndexedAccess）
- ✅ eslint 通过
- ✅ `tests/subpackage-audit.mjs` 通过（分包结构 / 页面齐全 / 组件引用 / 导航目标 / 跨包引用）
- ✅ prettier check 通过
- ⚠️ 现有 `tests/*.test.ts` 中 `tracker.test.ts` 失败为**既有环境问题**
  （Node 24 `--experimental-strip-types` 不支持 TS enum，与本次改动无关，197/198 通过）

### 修复记录（2026-08-10 二轮）

真机反馈「只显示一个板块」，定位到 **treemap-layout.ts 布局算法两处 bug**，用真实东财
数据（496 板块）Node 脚本回归验证后修复：

| Bug | 现象 | 修复 |
|-----|------|------|
| 布局主循环 `for...of` + `continue` 丢节点 | 被放回 remaining 的节点永不重新处理 → `layout` 数组出现 `undefined`，组件只画到第一个有效块 → **看起来只有一个板块** | 改为迭代式 `while + index` 贪心凑行，切行后从当前 index 重新处理，杜绝丢节点 |
| `worst()` 纵横比公式错误（total² 且长/短边处理颠倒） | 切行判断失效 → 全部节点堆成一行（distinct y=1、overlaps≈12 万） | 改用数学正确公式 `max((max·t)/(total·s), (total·s)/(min·t))` |
| 行布局按「行+剩余」总权重铺块 + rect 收缩两套比例不一致 | 块尺寸与空间不匹配 → 大量重叠 | 行沿长边铺开、行厚度 = 短边 × rowTotal/total，两处口径统一 |
| 东财行业列表本身含重复板块（BK1202/BK0739/BK1247 各出现两次） | 同名板块重叠绘制、命中只取第一个 | 数据层按 code 去重 |

**回归结果**（Node 脚本，真实数据）：496 节点全部布局、`missing=0`、`coverage=100%`、
`overlaps=0`（去重后），ASCII 渲染为标准 squarified treemap 形状。

### 后续可选增强（未实施）

- 方案 B 后端代理聚合（生产建议：域名白名单 + 服务端缓存 + 限流）
- 复盘模式（52etf 私有历史快照无法复刻，需自建当日快照）
- 多市场切换（深证/创业板/科创板/港股）
- 板块详情跳转（现有 sector-detail 可复用）
- 截图分享海报（复用 share-poster 链路）

字段速查：`f2` 最新价 / `f3` 涨跌幅 / `f5` 成交量 / `f6` 成交额 / `f8` 换手率 / `f12` 代码 / `f14` 名称 / `f20` 总市值 / `f21` 流通市值 / `f100` 行业 / `f103` 概念 / `f104` 板块内上涨家数 / `f105` 板块内下跌家数 / `f128` 领涨股名 / `f140` 领涨股代码。
