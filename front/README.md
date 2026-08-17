# 市场魔方助手小程序

原生微信小程序前端，使用 TypeScript + MobX，服务于仓库中的股票行情后端。

## 打开项目

使用微信开发者工具打开当前 `front/` 目录。

开发环境 API host 在 `config/env.development.ts` 中配置，默认值为：

```text
http://100.90.180.33:18487
```

页面和业务代码不直接写死 host，所有请求路径集中在 `api/` 目录中。

## 数据策略

- **全球 / 日韩 / 有色** 三个 TabBar 行情页的数据**不再走后端**，全部直连
  `docs/tabbar-api.md` 中的外部行情接口：
  - ① 腾讯行情 `https://qt.gtimg.cn`（文本）
  - ② 新浪行情 `https://hq.sinajs.cn`（文本）
  - ③ 东财个股行情 `push2delay.eastmoney.com/api/qt/stock/get`
  - ④ 东财列表行情 `push2delay.eastmoney.com/api/qt/ulist.np/get`
  - ⑤ 跳转小程序配置 `douyin.aaaa5.cn`（设置页使用，已一并封装）
- 封装分层（新增文件）：
  - `api/quote.ts`：5 个外部接口的单接口封装（失败降级为空数据，不抛错）；
  - `utils/quote.ts`：多源聚合 `fetchAccurate`（共识取中位数）、板块涨跌幅
    `fetchAShareBoardChangeMap` / `fetchUsProxyChangeMap`；
  - `utils/market-session.ts` + `utils/market-clock.ts`：A股/美股会话判定（30s 缓存）；
  - `config/tabbar.ts`：三个页面（全球指数/宏观资产/行业板块 24 项、日韩指数/个股/汇率、
    有色金属）的标的与数据源配置；
  - `utils/quote-parser.ts` / `utils/quote-consensus.ts`：纯解析 / 共识纯函数（可单测）。
- **财经（新闻）、搜索、个股/板块详情、新闻列表**等仍走后端接口
  （`api/news.ts`、`api/stock.ts`、`api/sector.ts`）。
- 请求路径集中在 `api/` 目录；外部接口失败时按「新浪 → 腾讯 → 东财」兜底链补齐，
  全部失败时页面展示错误态。

### 外部域名配置（必读）

小程序直连外部行情接口需要：

1. 在**微信公众平台 → 开发管理 → 服务器域名 → request 合法域名**中配置：
   `https://qt.gtimg.cn`、`https://hq.sinajs.cn`、`https://push2delay.eastmoney.com`、
   `https://douyin.aaaa5.cn`（若用到跳转配置）；
2. 开发调试时在微信开发者工具中勾选「不校验合法域名」；
3. 新浪接口对 `Referer` 有校验，小程序端无法自定义 `Referer`，若线上被拒（403），
   会由腾讯/东财兜底链自动补齐，或考虑加一层 BFF 转发。

## 依赖安装

在仓库根目录执行：

```bash
pnpm install
pnpm --filter market-magic-mini type-check
pnpm --filter market-magic-mini lint
```

当前执行环境无法访问 npm registry，因此依赖版本沿用当前 lockfile 中记录的稳定版本，并按项目约束将 TypeScript 目标提升到 5.8+、ESLint 使用 9 flat config。联网后建议重新运行 `pnpm view <package> version` 校验版本。

## 页面

- `/pages/global/index`：全球
- `/pages/asia/index`：日韩
- `/pages/metals/index`：有色
- `/pages/finance/index`：财经
- `/pages/settings/index`：设置
- `/pages/search/index`：股票搜索（四个市场页头部入口）
- `/pages/stock-detail/index?code=000001`：股票详情（行情 / K线图 / 新闻 / 公告，支持分页与下拉刷新）
- `/pages/sector-detail/index?cid=300382`：板块详情（板块K线图 / 成分股行情）
- `/pages/news/index`：新闻（支持分页与下拉刷新）
- `/pages/news-detail/index`：新闻详情
- `/pages/legal/index?type=data-notice`：协议与说明
