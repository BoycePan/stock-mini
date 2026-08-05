# wx-app-stock

股票行情微信小程序，前端位于 `front/`，仓库使用 pnpm workspace 管理。

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 常用命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm format:check
pnpm check
```

也可以通过 workspace filter 直接运行前端 package：

```bash
pnpm --filter market-magic-mini test
pnpm --filter market-magic-mini type-check
```

使用微信开发者工具打开 `front/` 目录。
