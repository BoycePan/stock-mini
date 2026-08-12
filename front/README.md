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

- 所有页面数据（认证、股票、板块、新闻、全球/日韩/有色/财经行情）均来自后端接口
  （见 `../docs/API.md`），请求路径集中在 `api/` 目录；接口失败或无数据时页面展示错误态。

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
