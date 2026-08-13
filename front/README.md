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

## 自动上传 / 预览（miniprogram-ci）

使用 `miniprogram-ci@2.1.31`（最新稳定版）集成 CI 上传脚本，可在本地命令行或 GitHub Actions 中
自动上传开发版本 / 生成预览二维码，无需手动打开微信开发者工具。

### 前置条件

1. 在「微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传」生成上传密钥，
   并将执行环境出口 IP 加入白名单；
2. 将密钥放到仓库根目录 `keys/private.<appid>.key` 或 `front/keys/private.key`（均已 gitignore），
   或通过环境变量 `WX_PRIVATE_KEY` 传入密钥内容。

### 常用命令（仓库根目录执行）

```bash
pnpm upload                        # 上传开发版本（默认 1 号机器人，版本号取仓库根 package.json）
pnpm upload -- --version=1.2.0 --desc=发版   # 自定义版本号与备注
pnpm upload -- --dry-run           # 只校验配置与密钥，不真正上传
pnpm upload:preview -- --page=pages/global/index   # 生成预览二维码
```

详细参数见 `scripts/upload.ts` 头部的注释（或 `pnpm upload -- --help`）。

### GitHub Actions

`.github/workflows/frontend-upload.yml` 会在 main 分支的 `front/` 变更时自动上传。
首次使用需在仓库配置：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `WX_PRIVATE_KEY` | Secret | 上传密钥文件内容（推荐） |
| `WX_UPLOAD_VERSION` | Variable | 上传版本号，如 `1.0.1`；留空时自动生成 `1.0.<run_number>` |
| `WX_ROBOT` | Variable | 机器人编号 1-30，默认 1 |
| `WX_APPID` | Variable | 可选，默认读 `project.config.json` |

> 注意：GitHub 托管运行器出口 IP 会变化，若密钥 IP 白名单无法覆盖，请改用自托管 runner
> 或通过 `WX_CI_PROXY` 指定固定出口 IP 的 HTTP 代理。
