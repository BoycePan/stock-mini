# 补齐指数 & 全球 ETF 板块 —— 调研与实施方案

> 对象：`front/` 小程序「市场追踪助手」
> 生成日期：2026-09-02（分支 `pz902_tmp`）
> 性质：**项目制定文档**（调研 + 方案 + 实施计划）。仅含前端改动与文档改动；**不涉及后端 `/api/**` 接口变更**。
> 来源：`docs/小程序金融合规检查清单.md` 第 11 项「补齐全球指数/全球ETF板块」（合规判定 🟢 低风险，可做）。

---

## 0. 结论摘要（先读）

| 决策点 | 结论（已确认） | 一句话理由 |
| --- | --- | --- |
| 产品形态 | **独立子页 + 全球页入口卡**（仿「市值TOP100」先例） | 5 个 Tab 已满；子页不动信息架构、改动最小、可回滚 |
| 数据通道 | **前端直连外部源（腾讯 / 新浪 / 东财）** | 与全球/日韩/有色三个行情页同构：8s 刷新、卡片点开当日分时、无后端依赖、无新增 request 合法域名 |
| 本期范围 | **精选补齐**：指数补 ~10 张卡（A股宽基 4 + 港股 3 + 美股补 2 + 欧洲待实测 1–3）；全球 ETF 精选 ~26 只（宽基 4 + 行业 8 + 主题 6 + 商品 4 + 区域 5） | 克制、与现有 24 行业板块代理股呼应，避免卡片爆炸 |

**为什么能直连补齐**：候选标的（A股宽基 / 港股 / 美股 ETF）在现网三宿主（`qt.gtimg.cn`、`hq.sinajs.cn`、`push2delay.eastmoney.com`）上大部分已有**仓库内实测依据**（见 §2.2 / §3.2 引用）；少部分欧洲指数与个别 ETF 代码是唯一缺口，由 Phase 1 实测脚本裁决（无源即砍，不做雅虎直连——大陆被墙）。

---

## 1. 现状盘点

### 1.1 前端现状（`front/`）

- Tab 结构（5 个，已满）：全球 / 日韩 / 有色 / 财经 / 设置；行情页由 `utils/market-page-factory.ts` 的 `createMarketPage` 统一生成（MobX `MarketStore` + `bindTheme` + 8s 自动刷新 + 分享海报 + 分时跳转）。
- 行情页数据**全部前端直连**外部接口（`api/quote.ts` + `utils/quote.ts` 多源聚合），不走后端（财经页新闻、搜索、登录走后端）。
- **指数现状（很窄）**：
  - 全球页「A股指数」：上证 / 深成 / 创业板 / 科创50 + A股平均股价（`config/tabbar.ts` `GLOBAL_INDICES` + `AVG_PRICE_CONFIG`，取数在 `api/market.ts` `getGlobalMarketPage`）；
  - 全球页「美股指数」：道琼斯 / 标普500 / 纳斯达克 + 市值TOP100 入口卡；
  - 日韩页：KOSPI / KOSDAQ / 日经225 / TOPIX / 越南胡志明 / SENSEX。
  - **缺**：A股宽基（沪深300 / 上证50 / 中证500 / 中证1000）、港股（恒指 / 恒生科技 / 国企）、美股补充（纳指100 / 罗素2000）、欧洲主要市场指数。
- **ETF 现状：没有任何直接展示的 ETF 卡片**。ETF 只以两种间接形态存在：
  1. 「行业板块 24 项」的美股代理股里有 9 只 ETF（SOXX/BATT/ROBO/DRIV/TAN/XLE/FCG/GDX/REMX，见 `INDUSTRY_BOARDS.proxies`）——但展示的是**板块涨跌幅**而非 ETF 价格；
  2. 宏观资产 `TLT` 卡片 = 美债 20 年+ ETF 价格（`105.TLT` 等）。
- **已写好但从未接线的现成代码**：`front/api/global.ts`（`globalApi`：后端 `/api/v1/index/*` 29 指数、`/api/v1/global-sector/*` 45 板块 ETF 的 list/klines/quote 客户端）+ `front/types/global.ts` —— 全仓库无任何调用点。走「后端雅虎」通道时可直接复用（本次未选该通道，文档保留此入口说明见 §7）。

### 1.2 后端现状（`backend-java/`，仅调研不修改）

| 接口 | 覆盖 | 刷新机制 | 备注 |
| --- | --- | --- | --- |
| `GET /api/v1/index/list` | 29 个雅虎全球指数（us/cn/hk/jp/kr/欧/美洲） | `quote_snapshot` 60s 定时刷新，只刷当前开市 | `docs/API.md` 一 |
| `GET /api/v1/global-sector/list` | 45 个雅虎板块 ETF（us 行业 9 / 主题 26 / global 行业 10） | 同上 | `docs/API.md` 二 |
| `…/{code}/klines`、`…/{code}/quote` | 日 K（DB）与实时行情（sidecar 透传 10s 缓存） | 每日 6:00 拉日线落库 | 不选原因：快照 60s 粒度 + 登录态 + 时效为延迟口径 |

### 1.3 合规定位（复核 `docs/小程序金融合规检查清单.md`）

- 「补齐全球指数 / 全球ETF板块」🟢 低风险：纯客观行情展示。**红线提醒**：ETF 分区标题 / 卡片不得出现「推荐 / 值得买 / 抄底」等倾向性文案；卡片、页尾沿用免责声明（公开接口数据、可能有延迟、仅供参考、不构成投资建议）；腾讯美股/ETF 与东财 delay 节点为**延迟行情**，页脚/说明需有「延迟/仅供参考」口径，不能写「实时」。

---

## 2. 目标与范围（MVP 定义）

### 2.1 新增页面信息架构

```
全球页（Tab 1）
└─「美股指数」分区末尾：新增入口卡「全球指数 · 全球ETF」
      （featured 整行横幅，仿 us-top100 入口卡，code = 'index-etf'）
      ↓ wx.navigateTo
packageQuote/pages/index-etf/index   ← 新子包页面（packageQuote 已被 global 页 preloadRule 预载）
   ├─ 分区 A「A股宽基指数」  4 卡
   ├─ 分区 B「港股指数」     3 卡
   ├─ 分区 C「美股补充指数」 2 卡（欧洲 1–3 卡按 Phase 1 实测决定放 C 或单列 D「欧洲主要指数」）
   ├─ 分区 E「美股ETF·宽基」 4 卡
   ├─ 分区 F「美股ETF·行业」 8 卡
   ├─ 分区 G「美股ETF·主题」 6 卡
   ├─ 分区 H「商品/债券ETF」 4 卡
   └─ 分区 I「全球区域ETF」  5 卡
   （顶栏或后续迭代再做「指数 | 全球ETF」分段切换，MVP 单页顺序滚动）
```

- 分区复用 `section-card` / `market-page` 渲染（与三个行情页同款网格 + 「分时」角标 + 点击看当日分时），深浅色主题由组件既有机制保证。
- 卡片展示：图标（emoji 或本地 png）、中文名、最新价（指数点位 / ETF 美元价）、涨跌幅徽标、市场状态胶囊（可复用 `utils/market-clock.ts` 的 `getRegionStatus`，按 region 打盘面状态）。

### 2.2 指数清单草案（新增卡；带仓库内实测依据的标注）

| 分区 | 卡片（中文名 / 展示 code） | 腾讯 | 东财 secid（quote/分时） | 依据 / 状态 |
| --- | --- | --- | --- | --- |
| A A股宽基 | 沪深300 `sh000300` | `sh000300` | `1.000300` | A股指数代码规范，东财 `1.` 市场常规可用 |
| A | 上证50 `sh000016` | `sh000016` | `1.000016` | 同上 |
| A | 中证500 `sh000905` | `sh000905` | `1.000905` | 同上 |
| A | 中证1000 `sh000852` | `sh000852` | `1.000852` | 同上 |
| B 港股 | 恒生指数 `HSI` | `hkHSI`（待实测） | `100.HSI` | 东财 100.HSI 已实测（魔方板块-接口文档附录A）；腾讯 hk 指数代码待实测 |
| B | 恒生科技 `HSTECH` | `hkHSTECH`（待实测） | `124.HSTECH` | 东财 124.HSTECH 已实测（同上） |
| B | 恒生国企 `HSCEI` | `hkHSCEI`（待实测） | `124.HSCEI`（待实测） | 无源则砍（可留恒指+恒科） |
| C 美股补 | 纳斯达克100 `NDX` | `usNDX`（待实测） | `100.NDX` | 东财 100.NDX 已实测且为 usIXIC 分时同源（minute.ts） |
| C | 罗素2000 `RUT` | `usRUT`（待实测） | `100.RUT`（待实测） | 无源则砍 |
| D 欧洲（待实测） | 富时100 `FTSE` / 德国DAX `GDAXI` / 法国CAC40 `FCHI` | 腾讯欧指代码（待实测） | `100.FTSE` / `100.GDAXI` / `100.FCHI`（**均待实测**，东财 100.* 是否收录以 Phase 1 为准） | 无大陆直连源则本期不做（提示：走后端雅虎可全覆盖，见 §7 备选） |

> 与现状去重：上证/深成/创业板/科创50、道指/标普500/纳指综合、费半（SOX 宏观卡）、VIX 均已有，不重复上卡。亚太指数归日韩页，不在本页重复。

### 2.3 全球 ETF 清单草案（~26 只；中文名以配置驱动，不依赖外部源英文名）

| 分区 | 标的（展示 code / 中文名） | 说明（东财市场归属待 Phase 1 实测） |
| --- | --- | --- |
| E 宽基 | SPY 标普500 / QQQ 纳指100 / DIA 道指 / IWM 罗素2000 | 美股四大宽基 |
| F 行业（SPDR Select Sector） | XLK 科技 / XLF 金融 / XLV 医疗 / XLE 能源 / XLI 工业 / XLB 材料 / XLU 公用事业 / VNQ 房地产 | 与后端 45 板块全集中的 us 行业 9 对齐（缺 XLP 必需消费可并入或砍） |
| G 主题 | SMH 半导体 / XBI 生物科技 / ITA 军工 / ARKK 颠覆创新 / ICLN 清洁能源 / HACK 网络安全 | 与现有 24 行业板块代理股（SOXX/GDX/ROBO…）呼应但不重复上卡 |
| H 商品/债券 | GLD 黄金 / SLV 白银 / USO 原油 / UNG 天然气 | TLT 已在宏观资产卡（105.TLT），不重复 |
| I 全球区域 | EEM 新兴市场 / EFA 发达市场 / EWJ 日本 / EWY 韩国 / FXI 中国大盘 | 单国/区域 ETF，与日韩页呼应 |

> 最终卡表以 **Phase 1 实测结果**为准：任一标的在三宿主均无有效报价即从清单删除（宁缺毋滥，避免展示 "--"）。

---

## 3. 数据源调研结论

### 3.1 可复用取数设施（仓库内已具备，几乎零新代码）

| 能力 | 现有实现 | 备注 |
| --- | --- | --- |
| 腾讯批量行情（一次请求多标的） | `api/quote.ts` `fetchTencentQuotes(codes)` | 已有 usDJI/usINX/usIXIC/usTLT/usQQQ/usSPY 实测先例；GBK 字节解码已处理 |
| 新浪批量行情 | `fetchSinaQuotes(keys)` | `gb_*`（美股/ETF）已有 gb_TLT 实测先例 |
| 东财单标的报价 | `fetchEastmoneyQuote(secid)`（stock/get）| 100.HSI/124.HSTECH/105.NVDA 等实测先例 |
| 东财 ulist 单标的报价（fltt=2 十进制） | `fetchEastmoneyUlistQuote(secid)` | 宏观 GC/SI/TLT 同模式 |
| 多源共识取数（价格区间护栏 + 中位数） | `utils/quote.ts` `fetchAccurate(sources, …, {parallel})` | 宏观资产 10 项逐项循环的现成模式 |
| 当日分时跳转 | `config/minute.ts` `MINUTE_SOURCES` + `EM_US_SECID_RE`（105/106/107 秒级兜底） | ETF 卡 minuteCode 可直接指向已验证 EM secid |
| 展示图标/海报/主题/埋点 | `quote-pages.ts QUOTE_ICONS`、`share-poster.ts`、`bindTheme`、`tracker.ts` | 全部按 code 驱动，新增即用 |

### 3.2 已实测 / 已引用证据（引用位置）

| 事实 | 证据出处 |
| --- | --- |
| 东财市场号：`100`=全球指数（HSI/NDX/SPX/N225/KS11/TWII/SENSEX/VNINDEX/UDI）、`124`=港股指数（HSTECH）、`105/106/107`=美股（SPY/QQQ/NVDA…商品ETF GLD/SLV/TLT）、`0/1`=沪深 | `docs/魔方板块分析/魔方板块-接口文档.md` 附录A |
| 分时（trends2）已覆盖 100.* 亚欧指数、105/106/107 美股 ETF、1.000xxx 沪指、124.HSTECH 抓包 | `docs/minute-api.md`（覆盖表 + 验证矩阵）、魔方文档实测 |
| 腾讯美股/ETF 为延迟行情（非实时） | `docs/frontend-data-sources.md`「时间/延迟口径」 |
| 个别 ETF secid 在 push2delay 节点可能返回空（如 105.SPY/107.TLT 抓包时 `rc:100`） | 魔方文档（抓包观察）——**必须逐只实测**，失败代码不给「分时」角标 |
| 雅虎（Yahoo）大陆被墙，仅作大陆外兜底，禁止作为主源 | `config/minute.ts` 头注释 |
| 三行情页全部前端直连、不走后端 | `api/market.ts` 头注释 + `docs/基金板块功能分析与接口方案.md`「数据策略」 |

### 3.3 结论

1. **A股宽基 / 港股 / 美股 ETF 直连无风险**：腾讯批量 + 东财 secid 双通道，与现网同一宿主、同一解析器，**不需要新增 request 合法域名**（合规清单 §4 的技术前置自动满足）。
2. **欧洲指数是唯一硬缺口**：东财 `100.*` 是否收录 FTSE/GDAXI/FCHI 仓库无证据，Phase 1 必须实测；腾讯欧指代码同理。无源 → 本期不做欧股，或按 §7 备选补后端雅虎。
3. **ETF 分时可用性需要逐只验证**：push2delay 对部分 ETF secid 不稳；验证不过的卡片去掉「分时」角标、点击 toast 提示（复用 `minuteUnavailableTip`），与 KOSDAQ/TOPIX 现状同策略。
4. **名称与图标全部配置驱动**：外部源返回英文名或中文名不稳定，统一用配置中文名（同日韩个股先例）；emoji 图标进 `QUOTE_ICONS`，特殊标的可用本地 png（`config/icon-assets.ts`）。

---

## 4. 前端方案设计

### 4.1 数据模型与加载（不改后端、不动三个 Tab 页结构）

- 页面数据继续用 `MarketPageData`（`sections[]`）形状，新增页面**独立于 `MarketStore` 三 Tab key**：
  - 新建 `api/market-index-etf.ts`（或并入 `api/market.ts`）导出 `fetchIndexEtfPage(): Promise<MarketPageData>`；
  - 页面持有自己的 `loading/error/updatedLabel/sections` state（对齐 `us-top100` 的独立页模式），进入 `onLoad` 拉取、`onPullDownRefresh` 强刷、`onShow` 按「距上次请求 >5s」补刷（复用 `utils/auto-refresh.ts`，间隔建议 8s 与行情页一致），**不做常驻轮询**（子页非 Tab，无 keep-alive）。
- 取数编排（参照 `getGlobalMarketPage` 的分批思路，控制请求数）：
  1. 腾讯批量 1 次：全部指数 tencent code + 全部 ETF `us<code>`（一次请求）；
  2. 东财 ulist **批量** 1 次补齐：新增 `fetchEastmoneyUlistQuotes(secids: string[])`（现网 ulist.np/get 支持多 secid，当前只有单标的封装，新增为纯前端文件内函数）；
  3. 新浪 `gb_*` 批量兜底（可选，第三通道）；
  4. 逐卡多源共识（复用 `fetchAccurate` 或简化「腾讯优先、东财兜底」两段式），区间护栏用指数/ETF 价格合理区间。
- ETF 单价的 `em` secid 用「列表尝试」形态（同 `TLT` 的 `['105.TLT','106.TLT','107.TLT']` 先例），避免单市场号写死。

### 4.2 配置与映射（新增/修改清单）

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `front/config/tabbar.ts` | 新增 `MORE_INDICES`（A股宽基/港股/美股补/欧洲，结构仿 `GlobalIndexConfig` + `emSecid`）与 `GLOBAL_ETFS`（分区 + 每只 3 源 `QuoteSource[]` + 中文名 + 区间 + minuteCode） | 单一数据源：取数、分时、图标都从这里驱动 |
| `front/api/quote.ts` | 新增 `fetchEastmoneyUlistQuotes(secids[])` 批量（fields 复用 `EM_ULIST_FIELDS`） | 纯前端文件内函数 |
| `front/api/market.ts`（或新 `api/market-index-etf.ts`） | 新增 `fetchIndexEtfPage()` 编排：腾讯批量 → 东财批量 → 逐卡解析 → 组装分区 | 失败降级为空数据，整页空则抛「暂无行情数据」 |
| `front/utils/quote-pages.ts` | 新增 `buildQuoteIndexEtfPage(groups)`（复用 `sectionOf`/`metricOf`）；`QUOTE_ICONS` 补 ~40 个 code 的 emoji | 与 `buildQuoteGlobalPage` 同构 |
| `front/config/minute.ts` | `MINUTE_SOURCES` 补：A股宽基 `1.000300` 等、港股 `100.HSI`/`124.HSTECH`（按实测）、纳指100 `100.NDX`；ETF 用 `minuteCode = '105.SMH'` 风格直接命中 `EM_US_SECID_RE` 兜底 | 无源项不登记 → 无「分时」角标 |
| `front/types/quote.ts`（如需） | 无/少量 | ETF QuoteItem 完全复用 |
| `front/app.json` | `packageQuote.pages` 追加 `pages/index-etf/index` | preloadRule 已有 packageQuote，无需改 |
| `front/packageQuote/pages/index-etf/*` | 新页面四件套（ts/wxml/wxss/json） | 复用 `market-page` 组件渲染 sections + 加载/错误/重试 + 分享海报 |
| `front/pages/global/index.wxml`（数据在 `api/market.ts`） | 美股指数区尾追加入口卡 `code='index-etf'`（`featured` 横幅，文案「全球指数 · 全球ETF」） | 仿 us-top100 入口卡 |
| `front/utils/market-page-factory.ts` | `onMetricTap` 增加 `code === 'index-etf'` 分支 → `wx.navigateTo('/packageQuote/pages/index-etf/index')` + 埋点 | 入口拦截集中在此（现 us-top100 同处） |
| `front/utils/system-config.ts` | 不需要（入口恒展示，不走后端 display 开关） | — |

### 4.3 页面交互与体验细节（对齐既有规范）

- **主题**：页面根节点 `class="page theme-{{theme}}"`；`onLoad` 首行 `bindTheme(this)`、`onUnload` `unbindTheme(this)`；新增颜色只走 `app.wxss` 深浅规则或组件内 `dark` 类——**合入前手动切深色验收**。
- **分时**：卡片 `minuteCode` 命中分时源才显示「分时」角标；点击走现 `onMetricTap` 逻辑（无源 → toast，不误跳）；ETF 的 EM_US_SECID_RE 兜底让分时页直接用 `105.SMH` 式 secid。
- **海报/分享**：`market-page` 组件自带海报生成；子页 `onShareAppMessage` 返回 `/packageQuote/pages/index-etf/index`；ETF 密集分区可考虑 `hideFromPoster` 控制海报长度（实现时对照 `share-poster.ts` 的截面逻辑）。
- **埋点**：入口卡点击 `indexEtf.enter`（仿 `us.top100.enter`）；卡片点击复用现 `card.tap`（code 自动带出）；页面 PV 走自动路由埋点。
- **文案合规**：页脚复用 `disclaimer-footer`；ETF 分区 tip 写「美股/全球 ETF 公开行情（可能延迟），仅供参考，不构成投资建议」；标题避免「机会/布局」等诱导词。
- **缓存（可选加分项）**：本地缓存上次页面数据（对齐 finance 页 `getFinanceCache` 模式），冷启动先展示旧值再后台刷新。

---

## 5. 实施计划（分阶段）

> 提交遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `test:`）。每个 Phase 结束跑 `pnpm check`（test + type-check + lint + format:check）。

### Phase 0 — 数据源实测裁决（1 天，独立可并行）

- [ ] 写一次性验证脚本（仿 `front/scripts/verify-minute.ts`，Node + 现网域名）或开发者工具手工表：
  - 指数：`sh000300/000016/000905/000852`（腾讯）、`hkHSI/hkHSTECH/hkHSCEI`（腾讯）、`usNDX/usRUT`（腾讯）、东财 `1.000300/1.000016/1.000905/1.000852`、`100.HSI/124.HSTECH/124.HSCEI/100.NDX/100.RUT`、欧洲 `100.FTSE/100.GDAXI/100.FCHI` + 腾讯欧指码；
  - ETF ~26 只：腾讯 `us<code>`、新浪 `gb_<code>`、东财 `105./106./107.<code>`（记录每只实际命中的市场号）＋ 分时 trends2 是否可拉；
- [ ] 输出《实测矩阵》结论：确定最终卡表（含每卡 主源/兜底/分时 secid/有无分时角标）；欧洲指数无源 → 明确本期剔除或 §7 备选；
- [ ] 产出物：`docs/补齐指数与全球ETF板块-实测矩阵.md`（或并入本文档附录），作为后续所有配置的唯一依据。

### Phase 1 — 配置与数据层（半天～1 天）

- [ ] `config/tabbar.ts`：`MORE_INDICES` / `GLOBAL_ETFS`（含中文名、分区、区间护栏、minuteCode 建议）；
- [ ] `api/quote.ts`：新增 `fetchEastmoneyUlistQuotes(secids[])` 批量 + 单测（`front/tests/quote-parsers.test.ts` 附近补 parser 用例）；
- [ ] 取数编排 `fetchIndexEtfPage()` + `buildQuoteIndexEtfPage()` + `QUOTE_ICONS`；
- [ ] `config/minute.ts` 映射补全；
- [ ] 单测：`front/tests/` 新增 `index-etf.test.ts`（mock 取数 → 断言分区/卡片/兜底链/区间护栏）。

### Phase 2 — 页面与入口（1 天）

- [ ] `app.json` 注册 `pages/index-etf/index`；
- [ ] 新页四件套（ts/wxml/wxss/json），复用 `market-page`/`section-card`；
- [ ] 全球页入口卡（`api/market.ts` usIndices 尾部 append）+ `market-page-factory.onMetricTap` 分支 + 埋点 `indexEtf.enter`；
- [ ] 分享/海报/下拉刷新/自动补刷接入。

### Phase 3 — 收尾验收（半天）

- [ ] 深色主题切换验收（设置 → 主题模式），逐分区检查对比度；
- [ ] 海报导出、分享链路检查（`share-poster.ts` / `kline-poster.ts` 无需改但需回归）；
- [ ] 埋点事件打点验证（`tracker.ts` 事件表核对）；
- [ ] `pnpm check` 全绿；
- [ ] 文档同步：`docs/前端图标清单.md`（新 icon 表）、`docs/frontend-data-sources.md`（若范围描述有变）、`docs/小红书文案规范.md` 事实清单（若文案素材要引用 ETF 页，需对照代码核实）；
- [ ] 纯前端改动，无 `/api/**` 变更 → **不需要** `docs/每日修改记录/` 新文件；若中途申请新增后端兜底接口则另行记录。

---

## 6. 验收清单（Definition of Done）

- [ ] 全球页可见「全球指数 · 全球ETF」入口卡，点击进入子页无报错；入口卡在深浅色主题下均清晰（featured 渐变两套色）。
- [ ] 指数分区：A股宽基/港股/美股补全部有值（无 "--" 假值）；区间护栏生效（异常源被丢弃）。
- [ ] ETF 分区：每只 ETF 价格/涨跌幅与腾讯或东财口径一致；中文名与配置一致（不显示外部源英文名）。
- [ ] 支持分时的卡片显示「分时」角标并可打开当日分时（口径与卡片同标的）；实测无分时的卡片点击 toast 提示。
- [ ] 下拉刷新、自动补刷（>5s 门闩）、错误态重试、空态均正常；页面不常驻轮询。
- [ ] 深色主题：无白底/黑字不可读区域；页脚免责声明、分区 tip 文案在深浅色下均可读。
- [ ] 分享海报生成成功且不含无意义条目（ETF 密集时按 `hideFromPoster` 裁剪）。
- [ ] `pnpm check` 通过；提交信息按 Conventional Commits。

---

## 7. 备选方向（本次未采纳，留档）

1. **走后端雅虎通道**：`front/api/global.ts` + `types/global.ts` 已就绪，仅需新页调用 `/api/v1/index/list`（29）与 `/api/v1/global-sector/list`（45）+ 卡片点击改走 `/quote`/`/klines`（日 K）。优点：欧洲/拉美全覆盖、有日 K 线；缺点：快照 60s、页面高频刷新无意义、登录态依赖、雅虎口径为延迟数据（时效标注更重）。适合未来「指数详情页 + 日 K」迭代，与直连卡片并存（直连做行情速览、后端做深度页）。
2. **欧股补全的最小代价**：本期若实测东财无欧洲指数源，可在 Phase 3 之后单独评估把欧股指数卡走后端 `/api/v1/index/list?market=gb|de|fr`（后端已支持 market 分组），以「混合通道」补齐——入口卡内分区混排不同通道需各自维护刷新节奏，建议拆成独立分区/独立页，避免一页双刷新机制。
3. **ETF 详情/成分**：板块 ETF 成分股 = 现「板块详情/成分股」后端能力的复用面，属另一期功能（不在本期）。

---

## 8. 风险与边界

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 东财 push2delay 对个别 ETF secid 返回空（抓包先例） | 卡片 "--" / 分时失效 | Phase 0 逐只实测；三源兜底；无源即砍或去掉分时角标 |
| 欧洲指数无大陆直连源 | 本期无法上欧股 | 明确剔除或 §7-2 混合通道补 |
| 腾讯/东财美股 ETF 为延迟行情 | 用户误以为实时 | 页脚/分区 tip 如实标注「可能延迟」，合规清单 §5 第 4/5 条 |
| 卡片数量膨胀 | 页面长、维护量大 | MVP 锁定 ~10 指数 + ~26 ETF；后续增量走后台配置式清单（需后端支持时另议） |
| 港股指数腾讯代码未验证 | 恒指卡依赖东财 | Phase 0 实测；东财为主源时腾讯作兜底即可 |
