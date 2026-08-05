# 市场魔方助手小程序

原生微信小程序前端，使用 TypeScript + MobX，服务于仓库中的股票行情后端。

## 打开项目

使用微信开发者工具打开当前 `front/` 目录。

开发环境 API host 在 `config/env.development.ts` 中配置，默认值为：

```text
http://100.90.180.33:8080
```

页面和业务代码不直接写死 host，所有请求路径集中在 `api/` 目录中。

## 数据策略

- 股票、板块、新闻和认证：调用 `doc/API.md` 中已有的后端接口。
- 全球、日韩、有色和部分 AI 指标：后端暂未提供时使用 `mocks/` 下的数据。
- Mock 数据通过 Provider 入口返回，后续增加后端接口时只替换 `api/market.ts`，无需修改页面。

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
- `/pages/ai/index`：AI
- `/pages/settings/index`：设置
- `/pages/stock-detail/index?code=000001`：股票详情
- `/pages/sector-detail/index?cid=300382`：板块详情
- `/pages/news/index`：新闻
