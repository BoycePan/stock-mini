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

## 后端部署

后端通过 GitHub Actions 预编译为 Linux 静态二进制，不需要在服务器安装 Go 或下载 Go modules。

向 `main` 分支推送后，`.github/workflows/deploy.yml` 会：

1. 使用 Go 1.25 执行后端测试。
2. 构建 `linux/amd64` 和 `linux/arm64` 版本。
3. 生成压缩包和 `SHA256SUMS`，并上传为 GitHub Actions Artifact。
4. 通过现有的 `SSH_HOST`、`SSH_USER`、`SSH_PRIVATE_KEY` secrets 上传服务器。
5. 使用 systemd 原子切换版本并执行健康检查。

服务器需要满足：

- systemd 可用；
- SSH 用户可以管理 `/apps/stock` 和 systemd；
- 真实配置文件位于 `/apps/stock/backend/config.yaml`；
- 端口 `18487` 可供后端使用。

首次从 Docker 切换到二进制部署前，先确认服务器真实配置中的监听端口：

```yaml
server:
  port: 18487
```

发布文件位于 `/apps/stock/releases/`，当前版本是 `/apps/stock/current`。服务名为
`wx-app-stock-backend.service`，可以使用以下命令查看：

```bash
systemctl status wx-app-stock-backend
journalctl -u wx-app-stock-backend -n 100 --no-pager
```

Docker Compose 仍保留作为手动回退方式，但自动部署不再执行服务器端 Docker 构建。
