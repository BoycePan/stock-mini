# 门户网站（market-tracker-portal）

「市场追踪助手」小程序的引流门户网站，使用 **Astro 7（SSG 纯静态、多页 SEO）** 构建。
目标：通过搜索引擎关键词（金价 / 美股 / A股 / 日经 / KOSPI 等）带来访客，首页与各落地页提供
**小程序码扫码入口**引导用户打开小程序。

## 技术栈

- **Astro 7**：静态站点生成（`output: 'static'`），构建产物 `dist/` 可直接由 nginx 托管
- **@astrojs/sitemap**：自动生成 `sitemap-index.xml` / `sitemap-0.xml`
- **TypeScript 5.8** + `astro check` 类型检查；**Prettier** + `prettier-plugin-astro` 格式化
- 无框架、无 Tailwind：纯 CSS 变量实现**浅色 / 深色双主题**（默认跟随系统，可手动切换并持久化）

## 目录结构

```
portal/
├── astro.config.mjs        # SSG + site + sitemap 集成
├── public/
│   ├── logo.png            # 品牌 logo（从 front/static/images/logo.png 复制）
│   ├── miniprogram-code.png# ⚠️ 占位图，上线前替换为真实小程序码
│   └── robots.txt          # Allow all + sitemap 指向
└── src/
    ├── config/site.ts      # 全站唯一配置：品牌名 / SITE_URL / 免责声明等
    ├── layouts/Base.astro  # 页头导航 + 页脚免责 + 主题防闪烁脚本
    ├── components/         # Seo / Header / Footer / ThemeToggle / MarketWall / QrCta ...
    ├── data/               # features.ts / faq.ts（功能事实清单，对照 front/ 代码核实）
    ├── styles/global.css   # 双主题令牌表（色板与 AGENTS.md 一致）
    └── pages/              # 首页 + 6 个 SEO 落地页 + features/faq/legal/404
```

## 本地开发

在仓库根目录执行：

```bash
pnpm install
pnpm portal:dev            # http://localhost:4321
pnpm portal:check          # astro check（类型检查）
pnpm portal:build          # 构建 dist/
pnpm portal:preview        # 预览构建产物
pnpm portal:format:check   # prettier 格式检查
```

## 上线前必做（用户操作）

1. **替换真实域名**：编辑 `portal/src/config/site.ts` 的 `SITE_URL`（同时同步 `astro.config.mjs` 的 `site`）。
2. **替换小程序码**：在微信公众平台生成「市场追踪助手」小程序码，覆盖
   `portal/public/miniprogram-code.png`（当前为占位图）。
3. **确认微信内搜索名称**：`src/config/site.ts` 的 `WECHAT_SEARCH_NAME`，以微信内实际可搜索到的名称为准。
4. **确认文案事实**：站点功能文案对照 `front/` 代码核实（事实清单见 `src/data/features.ts`、
   `docs/小红书文案规范.md`）；金店数量等数字以代码为准。

## 部署（自有服务器 nginx）

GitHub Actions 工作流 `.github/workflows/portal-deploy.yml`：main 分支 `portal/**` 变更时
自动构建并上传 `dist/` 到服务器，复用后端部署的 SSH secrets（`SSH_HOST` / `SSH_USER` /
`SSH_PRIVATE_KEY`）。

### 服务器 Variables（仓库 Settings → Secrets and variables → Actions）

| Variable              | 说明                                      | 默认值               |
| --------------------- | ----------------------------------------- | -------------------- |
| `PORTAL_DEPLOY_PATH`  | 服务器上静态文件目录（nginx root 指向它） | `/apps/stock/portal` |
| `PORTAL_RELOAD_NGINX` | 上传后是否 `nginx -s reload`              | 不设置则不重载       |
| `SSH_PORT`            | SSH 端口（已有则复用）                    | `22`                 |

### nginx 站点配置示例

```nginx
server {
    listen 80;
    server_name portal.example.com;   # 替换为真实域名

    root /apps/stock/portal;
    index index.html;

    # 静态资源缓存（_astro/ 下是带 hash 的构建产物）
    location /_astro/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA 无关的纯静态站点：.html 后缀与目录路由都可用
    location / {
        try_files $uri $uri.html $uri/ /404.html;
    }

    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # 生产环境建议：HTTPS + HTTP/2（certbot 或托管证书）
}
```

> 部署路径、域名解析与 nginx 站点落地属于服务器侧操作，需自行完成；
> 若服务器已有站点模板，把 root 改为 `PORTAL_DEPLOY_PATH` 即可。

## 合规说明

- 全站文案遵循 `docs/小红书文案规范.md`：无金融诱导词（稳赚 / 必涨 / 推荐买入 / 带你炒股 等）；
- 每页页脚含固定免责声明：数据来自公开接口聚合、可能有延迟、仅供参考、不构成投资建议；
- 不编造功能：「自选股分组 / 价格提醒 / 交易功能」当前不存在，已在 features 页如实说明；
- 无法核实项（上架状态、微信内搜索名称）以「发布前请自行确认」方式表述，不写死为事实。

## 与小程序的关系

- 门户为**纯静态**站点，不调用任何后端 `/api/**` 接口，不修改 `backend-java/` 与 `front/` 现有代码；
- 品牌名与配色与小程序一致（`front/config/app.ts` 默认品牌 + AGENTS.md 色板）；
- 门户复用小程序 logo（复制而非引用，保持独立构建）。
