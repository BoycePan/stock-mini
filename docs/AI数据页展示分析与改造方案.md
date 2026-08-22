# AI 数据页展示与处理分析 —— 参考项目对照与改造方案

> 分析对象：参考项目 `~/code/self/test_project/stock_other_mini/src/`（AI 数据页 `pages/ai-data/ai-data` + `utils/quote.js` + `utils/market-session.js`）
> 改造对象：本仓库 `front/`（纯前端，符合 AGENTS.md「只改 front/，不改 backend-java/」约束）
> 说明：参考项目 ai-data 页为混淆字节码，`loadAll` 属「结构级还原」（参考项目 README 已注明，且其校验脚本 `verify_ai.js` 从不执行 loadAll）；本文档结论 = 编译产物 wxml/wxss（未混淆，完好）+ 原始模块字符串表 + 还原源码三重交叉确认，**真实标的列表未还原**，实施时按语义自定义。

---

## 0. 结论速览

参考项目 **TabBar 第 4 个 tab 是「AI」页**（全球 / 日韩 / 有色 / **AI** / 设置），展示两分区：

- **AI 产品价格**（A 股标的）+ **AI 设备价格**（美股标的），双列卡片，每条 = 名称 + 涨跌幅箭头（页面**不显示价格**，分享卡片里带价格）；
- 取数：A 股标的逐只走 `fetchAShareMulti`、美股标的逐只走 `fetchUsMulti`（都是腾讯 → 新浪 → 东财的多源共识聚合）；
- 会话：`resolveAiMarketSession`（全局实时会话 + 「AI」徽标，如「AI 盘前」），onLoad + **每次 onShow** + 下拉刷新。

本仓库（wx-app-stock/front）**没有 AI 页**（TabBar 第 4 个 tab 是「财经」），且缺三块基础能力：`fetchUsMulti`（美股多源聚合）、AI 会话徽标（`resolveAiMarketSession`/`withBadgeName`）、AI 标的配置。改动清单见 §3（微信 tabBar 上限 5 个，无法「加第 6 个 tab」，只能在「替换财经 tab」「独立二级页」「并入全球页」三者中选）。

---

## 1. 参考项目 AI 数据页展示方式

### 1.1 页面结构（`pages/ai-data/ai-data.wxml`，未混淆）

```
顶部 market-status：status-tag 胶囊（文字 = sessionBadge，如「AI 盘前」，class = sessionStatusClass 着色）
「AI 产品价格」section-card → grid-row → grid-card × N
    ├─ card-name（item.name）
    └─ card-chg {{item.toneClass}}（{{item.arrow}} {{item.changeText}}）  ← 无价格
「AI 设备价格」section-card → 同上
右上角「分享」入口 → Canvas 分享卡（renderElegantShare）
```

要点：

- **卡片只有名称 + 涨跌幅**（`grid-card` 内无 price 字段渲染）；涨跌色 `up #e54d42 / down #39b54a / flat #999`；
- 分区标题「AI 产品价格」「AI 设备价格」，title-line 橙红渐变；
- 顶部会话胶囊 `sessionStatusClass` 随阶段变色（复用 global 页同款 open/pre/post/closed 语义）。

### 1.2 数据处理（`ai-data.js` loadAll，结构级还原 + 字符串表确认）

原始模块字符串表（从 app-service.js 提取，逐项核实）包含：

```
getMarketSession, withBadgeName, resolveAiMarketSession, fetchAShareMulti, fetchUsMulti,
Promise, allSettled, concat, _lastAiKey, _lastLoadAt, renderElegantShare, valueMode,
subtitle, badgeLabel, statusText, sections, rows, ...
```

据此还原的处理流程：

```
loadAll():
 1. 会话 = resolveAiMarketSession()          // 全局实时会话 + 'AI' 徽标（字符串表证实）
 2. Promise.allSettled([
      fetchAShareMulti(<A股标的>…),          // AI 产品（A 股）
      fetchUsMulti(<美股标的>…),              // AI 设备（美股）
    ])
 3. productItems = A股结果.map(it => { name, price, pct })
    deviceItems = 美股结果.map(it => { name, price, pct })
    （wxml 消费 item.arrow / item.toneClass / item.changeText，原版 item 应有等价派生字段）
 4. setData({ productItems, deviceItems, loading:false, sessionBadge: 'AI …' })
```

刷新时机：`onLoad` 一次 + **每次 `onShow`（非首次）** + 下拉刷新；无定时器（onHide/onUnload 仅清 `_timer`）。`_lastAiKey` 为去重键（与有色页 `_lastNfKey` 同模式）。

分享卡 `_shareData()`：

```
rows = productItems ∪ deviceItems 映射为
  { label: name, value: price.toFixed(2), changeText: '+x.xx%', toneClass }
sections = [{ label: 'AI 数据', rows }]
subtitle = withBadgeName('AI', session)   // 「AI 盘前」等
valueMode = 'price'                        // 分享卡带价格，页面不带
```

### 1.3 取数函数（`utils/quote.js`，原文件未混淆，逐字可查）

| 函数 | 数据源链（fetchAccurate 多源共识聚合） | 容差 |
| --- | --- | --- |
| `fetchAShareMulti(code)` | 腾讯（原样代码）→ 新浪 A 股（小写）→ 东财（sh→`1.`、sz→`0.` 前缀推 secid） | relTol .01 / absTol .02 / pctTol .5，parallel 全源 |
| `fetchUsMulti(code)` | 腾讯（`us`+CODE）→ 新浪美股（`gb_`+小写）→ 东财 `105.` → `106.` → `107.` → 本站 stock | relTol .015 / absTol .05 / pctTol .6，parallel 3 |

共识规则（`fetchAccurate`/`pickConsensus`）：多源报价「相似」（绝对差或相对差小于容差）才归并取中位数；不足 2 源返回最高优先级首个有效值；`|pct|>80` 视为异常丢弃。

### 1.4 会话与徽标（`utils/market-session.js`）

- `resolveAiMarketSession()` = `resolveGlobalMarketSession().then(s => withBadgeName(s, 'AI'))`；
- `withBadgeName(name, session)`：`badgeLabel = name + ' ' + shortLabel` → 「AI 盘前 / AI 盘中 / AI 盘后 / AI 休市」，`statusClass` 随阶段（open/pre/post/closed）；
- 即 AI 页复用**全球页同一套实时会话**（价格活跃度 + 90min 新鲜度 + 30s 缓存），仅换徽标。

### 1.5 已知还原局限（如实记录）

1. **真实标的列表未还原**：原始模块字符串表中无任何股票代码，代码以字节码内部形式存在；还原版 `loadAll` 传 `[]` 占位（调用即失败），`verify_ai.js` 亦跳过 loadAll；
2. 还原版用 `getMarketSession()` + `Promise.all`，原版字符串表证实为 `resolveAiMarketSession` + `Promise.allSettled`；
3. 条目字段：还原版只写 `{name, price, pct}`，而 wxml 消费 `arrow/toneClass/changeText`，原版应有派生字段或模板另算。

实施时以**语义**为准：A 股 AI 产品标的 + 美股 AI 设备标的，标的清单由产品自定义（可参考本仓库 `config/tabbar.ts` 的 `INDUSTRY_BOARDS` 配置模式）。

---

## 2. 本仓库（wx-app-stock/front）现状对照

### 2.1 已有能力（可直接复用）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 行情页组件体系 | `components/market-page/` + `components/section-card/` | 分区卡片、singleLine 单行布局（无价格条目）、tip、分时角标、加载/错误/空态、**深浅主题内置** |
| 多源共识聚合 | `utils/quote.ts` `fetchAccurate` | 与参考项目同款（优先级排序 + 相似归并 + 中位数） |
| A 股单标的多源聚合 | `utils/quote.ts` `fetchAShareMulti`（第 235 行） | 腾讯 → 新浪A股 → 东财，可直接复用 |
| 全局实时会话 | `utils/market-session.ts` `resolveGlobalMarketSession`（第 44 行） | 4 路腾讯指数新鲜度修正 + 30s 缓存 |
| 分享海报 | `utils/share-poster.ts` + market-page 组件 | 支持紧凑单行分区（行业板块同款） |
| TabBar 主题 | `custom-tab-bar/` + `app.json` darkmode | 双主题 tabBar |

### 2.2 缺失项

| # | 缺失 | 参考项目对应 |
| --- | --- | --- |
| M1 | **美股单标的多源聚合 `fetchUsMulti`** | `quote.js` fetchUsMulti（腾讯 + 新浪 gb_ + 东财 105/106/107） |
| M2 | **AI 会话徽标** `resolveAiMarketSession` / `withBadgeName` | `market-session.js` resolveAiMarketSession |
| M3 | **AI 标的配置**（A 股 AI 产品 + 美股 AI 设备清单） | 参考项目字节码内（未还原） |
| M4 | **AI 页面 + TabBar 入口** | `pages/ai-data/ai-data`（Tab 第 4 个） |
| M5 | 分享卡带价格行的组装（海报 rows 含 price） | `_shareData` valueMode 'price' |

### 2.3 关键差异点

| 维度 | 参考项目 | 本仓库现状 | 影响 |
| --- | --- | --- | --- |
| TabBar 结构 | 全球/日韩/有色/**AI**/设置 | 全球/日韩/有色/**财经**/设置 | 无 AI 入口（微信 tabBar 上限 5 个，不能加第 6 个） |
| AI 会话徽标 | 「AI 盘前」等阶段徽标 | 无 | 需新增 withBadgeName + 页面徽标 |
| 取数 | fetchAShareMulti + fetchUsMulti | 只有 fetchAShareMulti | 美股标的无现成取数 |
| 页面卡片 | 名称 + 涨跌幅（无价格） | section-card 可配 singleLine 同款布局 | 展示层可复用 |
| 深色主题 | 参考项目无完整深色体系 | 本仓库有（AGENTS.md 强制） | AI 页须走现有主题体系 |

---

## 3. 改造方案（改动清单）

### 改动 1（必做）：新增 `fetchUsMulti` —— 美股单标的多源聚合

**位置**：`front/utils/quote.ts`（`fetchAShareMulti` 旁）。

对齐参考项目 `quote.js` `fetchUsMulti`：

```ts
/** 美股单标的多源聚合（对齐参考项目 quote.js fetchUsMulti）：
 *  腾讯 us+CODE → 新浪 gb_ → 东财 105 → 106 → 107，fetchAccurate 共识聚合 */
export async function fetchUsMulti(code: string): Promise<SourceQuote | null> {
  const usCode = bareUsCode(code) // 去 us / 105./106./107. 前缀，大写
  const sources: QuoteSource[] = [
    { kind: 'tencent', key: /^us/i.test(code) ? code : `us${usCode}` },
    { kind: 'sina_gb', key: usCode },
    { kind: 'em', secid: `105.${usCode}` },
    { kind: 'em', secid: `106.${usCode}` },
    { kind: 'em', secid: `107.${usCode}` },
  ]
  return fetchAccurate(sources, {}, { parallel: 3, relTol: 0.015, absTol: 0.05, pctTol: 0.6 })
}
```

前置条件核对（本仓库已有）：`QuoteSource` 支持 `sina_gb`/`em`/`tencent`（`types/quote.ts` + `utils/quote.ts` fetchOne）、`fetchAccurate` 已支持容差参数。**需验证 `sina_gb` 源当前是否已接通**（`fetchOne` 中 sina_gb 的分支与新浪批量预取路径）。

### 改动 2（必做）：AI 标的配置

**位置**：`front/config/tabbar.ts`（或新建 `front/config/ai.ts`，按产品偏好）。

参考 `INDUSTRY_BOARDS` 模式，新增两组标的：

```ts
export interface AiProductConfig { code: string; name: string }
/** AI 产品（A 股，走 fetchAShareMulti） */
export const AI_PRODUCTS: AiProductConfig[] = [
  // 示例：由产品确认清单，如 { code: 'sh688256', name: '寒武纪' } …
]
/** AI 设备（美股，走 fetchUsMulti） */
export const AI_DEVICES: AiProductConfig[] = [
  // 示例：由产品确认清单，如 { code: 'NVDA', name: '英伟达' } …
]
```

> 参考项目真实清单埋在字节码中未还原，此处清单为产品决策项，文档不臆造具体标的（遵守 AGENTS.md 文案规范精神：不编造无法核实的内容）。

### 改动 3（建议）：AI 会话徽标

**位置**：`front/utils/market-session.ts` + `front/utils/market-clock.ts`。

- 新增 `withBadgeName(name, session)`：返回 `badgeLabel = name + ' ' + shortLabel`（shortLabel 由 phase/usMode 映射：盘中/盘前/盘后/休市/午休…），对齐参考语义；
- 新增 `resolveAiMarketSession()` = `resolveGlobalMarketSession().then(s => withBadgeName('AI', s))`，供 AI 页复用（与全球页同会话，30s 缓存共享）；
- `MarketSession` 类型（`market-clock.ts`）如需展示胶囊，可扩展 `shortLabel/statusClass` 或复用现有 `statusTone` 映射（盘中 active / 盘前盘后 quiet / 休市 rest）。

### 改动 4（必做）：AI 页面与入口 —— 三选一

微信 tabBar **最多 5 个**，本仓库现有 5 个（全球/日韩/有色/财经/设置），无法直接加第 6 个：

| 方案 | 做法 | 改动量 | 说明 |
| --- | --- | --- | --- |
| **A. 替换财经 tab（推荐，对齐参考）** | TabBar 第 4 项「财经」→「AI」；财经页保留为二级页（设置/搜索入口进入） | 中 | 与参考项目 Tab 结构一致；财经页入口需另找（如设置页列表项） |
| B. 独立二级页（不进 tab） | 新增 `pages/ai/index`，从全局页/设置页入口 `wx.navigateTo` 进入 | 小 | 不动 tabBar；AI 数据入口变浅 |
| C. 并入全球页 | 全球页新增「AI 数据」分区 | 最小 | 非独立页，信息密度高，与参考「独立 tab」定位不符 |

**方案 A 涉及文件**：`front/app.json`（tabBar.list 第 4 项）+ `front/custom-tab-bar/index.ts`（list 与 iconClass，需新增 AI 图标字体类或图标）+ `front/utils/market-page-factory.ts`（`MarketPageKey` 加 `'ai'`，或 AI 页自建轻量页面）+ `front/stores/market.store.ts`（pages/loading/errors/lastRequestAt 加 `'ai'` key）+ `front/api/market.ts`（`MarketPageKey` 与 `getPage` 加 `'ai'` case）。

**AI 页数据组装**（`front/api/market.ts` 新增 `getAiMarketPage()`）：

```
session = await resolveAiMarketSession()
items = await Promise.all([
  ...AI_PRODUCTS.map(p => fetchAShareMulti(p.code).then(q => ({ ...p, price: q?.price, pct: q?.changePercent }))),
  ...AI_DEVICES.map(d => fetchUsMulti(d.code).then(q => ({ ...d, price: q?.price, pct: q?.changePercent }))),
])
→ buildQuoteAiPage({ productItems, deviceItems, sessionBadge: session.badgeLabel })
```

`buildQuoteAiPage`（`front/utils/quote-pages.ts` 新增）：两个分区「AI 产品价格」「AI 设备价格」，条目 `singleLine`（名称 + 涨跌幅，无价格，对齐参考页面），分区标题右侧胶囊显示「AI 盘前」等徽标（复用 `marketStatus/marketTone` 或新增 `badge`）。

### 改动 5（建议）：分享海报带价格

market-page 组件自带海报链路；AI 页分区条目无价格，但海报可带价格行（对齐参考 `_shareData` valueMode 'price'）：在 `buildQuoteAiPage` 中给条目补充 `posterValue`（或复用 `value` 字段仅在海报绘制时输出价格），`share-poster.ts` 的海报数据组装处透传。

### 改动 6（强制）：主题兼容

AI 页若走 `market-page` 组件体系则自动继承双主题（`bindTheme` + `theme-{{theme}}` 根节点 + section-card dark 变体）；**新增任何胶囊/分区配色必须按 AGENTS.md 色板补 `.theme-dark` 变体**（参考 global.wxss 已有的 open/pre/post/closed 深色覆盖写法）。

### 改动 7（建议）：测试

| 文件 | 内容 |
| --- | --- |
| `front/tests/quote-parsers.test.ts` 或新 `quote.test.ts` | `fetchUsMulti` 单测：mock 腾讯/新浪/东财多源，验证共识聚合与回退链 |
| `front/tests/quote-pages.test.ts` | `buildQuoteAiPage`：两分区组装、singleLine、徽标透传 |
| `front/tests/market-clock.test.ts` / `market-session.test.ts` | `withBadgeName` / `resolveAiMarketSession` 徽标映射 |

---

## 4. 影响面与风险

| 项 | 说明 |
| --- | --- |
| 后端 | 无（纯前端，符合 AGENTS.md）；AI 页全部直连外部接口（腾讯/新浪/东财），与全球页同机制 |
| tabBar 改动 | 方案 A 替换财经 tab 会影响现网用户习惯；财经页需保留二级入口（推荐设置页列表项） |
| 取数量 | AI 标的逐只 fetchAccurate（每只并发 2-3 源）；标的多时注意请求量与限流（参考 docs/tabbar-api.md 限流章节），建议标的 ≤ 10 只/组 |
| 真实标的清单 | 参考项目未还原，属产品决策；文档仅给出配置模式，不臆造清单 |
| 参考局限 | 参考项目 AI 页无完整深色主题；本仓库按自身主题体系实现，不照搬参考配色 |

---

## 5. 验收标准

1. 「AI」入口可见（方案 A：TabBar 第 4 项；方案 B：设置/全局页入口），点击进入 AI 数据页；
2. 页面展示「AI 产品价格」「AI 设备价格」两分区，每条 = 名称 + 涨跌幅（涨红跌绿），无价格；
3. 顶部徽标随会话显示「AI 盘前 / AI 盘中 / AI 盘后 / AI 休市」等，深浅主题下均可读；
4. 下拉刷新、onShow 自动刷新与全球页行为一致（onLoad 一次 + 每次 onShow + 下拉）；
5. 分享海报包含两分区数据与价格行，水印开关正常；
6. 单测通过：`fetchUsMulti` 多源回退、`buildQuoteAiPage` 组装、徽标映射；
7. 深浅主题切换后页面无不可读区域（AGENTS.md 验收标准）。
