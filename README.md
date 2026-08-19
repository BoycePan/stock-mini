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
pnpm --filter market-tracker-mini test
pnpm --filter market-tracker-mini type-check
```

使用微信开发者工具打开 `front/` 目录。

## 后端部署

后端通过 GitHub Actions 预编译为 Linux 静态二进制，不需要在服务器安装 Go 或下载 Go modules。

向 `main` 分支推送后，`.github/workflows/deploy.yml` 会：

1. 使用 Go 1.25 执行后端测试。
2. 构建 `linux/amd64` 和 `linux/arm64` 版本。
3. 生成压缩包和 `SHA256SUMS`，并上传为 GitHub Actions Artifact。
4. 通过 GitHub Secrets 中的 SSH 配置上传服务器。
5. 使用 systemd 原子切换版本并执行健康检查。

服务器需要满足：

- systemd 可用；
- SSH 用户可以管理 `/apps/stock` 和 systemd；
- 真实配置文件位于 `/apps/stock/backend/config.yaml`；
- 端口 `18487` 可供后端使用。

### GitHub Actions SSH 配置

在服务器的 1Panel 终端中，为部署用户安装 GitHub Actions 使用的公钥。下面的
`deploy_user` 替换成 GitHub Secret `SSH_USER` 对应的用户：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
vi ~/.ssh/authorized_keys
# 粘贴部署公钥的一整行并保存
chmod 600 ~/.ssh/authorized_keys
```

如果部署用户不是 `root`，还需要允许它免密执行部署脚本所需的 sudo 命令，
或者直接使用有权限的 root 账号。先在本地验证登录成功：

```bash
ssh -i ~/.ssh/wx-app-stock-deploy -p 22 deploy_user@服务器IP 'whoami'
```

如果 Actions 仍提示 `unable to authenticate`，先在服务器上查看已安装公钥的指纹：

```bash
ssh-keygen -lf ~/.ssh/authorized_keys -E sha256
```

它必须和 Actions 日志中 `Validate SSH private key` 输出的指纹一致。
如果服务器上有多行公钥，请逐行确认。指纹一致但仍失败时，检查
`SSH_USER` 是否就是该公钥所在用户，以及 `/home/<用户>/.ssh`、
`authorized_keys` 的所有者和权限。

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中配置：

| Secret | 内容 |
| ------ | ---- |
| `SSH_HOST` | 服务器 IP 或域名 |
| `SSH_USER` | 上面安装公钥的 SSH 用户 |
| `SSH_PRIVATE_KEY` | 对应私钥的完整内容，包含 `BEGIN` 和 `END` 行 |
| `SSH_PORT` | 服务器 SSH 端口；通常为 `22` |
| `SSH_PASSPHRASE` | 私钥有密码时填写，没有则可不设置 |

`SSH_PRIVATE_KEY` 必须是私钥，不是 `.pub` 公钥文件。私钥和服务器
`~/.ssh/authorized_keys` 必须是一对；如果 1Panel 修改过 SSH 端口，
`SSH_PORT` 也必须填写实际端口。

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
