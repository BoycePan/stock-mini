# CLAUDE.md

本仓库是「市场追踪助手」微信原生小程序（`front/`）+ Spring Boot 后端（`backend-java/`）。
本文件供 Claude（Claude Code 等）使用：**完整规则以根目录 `AGENTS.md` 为准**，本文件列出
关键约束，避免未读 AGENTS.md 时踩坑。

## 硬性修改范围（强制）

- 只允许修改前端代码，即 `front/` 目录；**禁止修改后端代码**，即 `backend-java/` 目录
  （含 `src/`、`pom.xml`、`Dockerfile`、`scripts/`）。
- 任务需要后端接口或数据变更时，明确指出所需变更，不要自行修改后端。
- 根目录 `提示词.md` 是给 AI 编码助手的提示词，与本文件配合使用。

## 主题兼容规范（强制，涉及任何 UI 改动时必读）

小程序支持浅色 / 深色双主题切换，是核心体验。任何页面、组件、样式、Canvas 绘制改动，
必须保证两种主题下都可读。

- 主题的单一数据源是全局 MobX store：`front/stores/settings.store.ts` 的
  `rootStore.settings.theme`；切换主题一律调用 `rootStore.settings.setTheme(theme)`。
- 页面 / 组件统一用 `front/utils/theme.ts` 的 `bindTheme(target)` / `unbindTheme(target)`
  订阅主题；页面根节点写 `class="page theme-{{theme}}"`。
- 自定义组件样式隔离（`styleIsolation: 'isolated'`）：深色样式必须写在组件自身 wxss，
  组件根节点加 `dark` 类；Canvas（K 线 / 分时）配色随主题切换。
- 色板、新增页面 / 组件检查清单、验收标准：见 `AGENTS.md`「主题兼容规范」。
- 改动页面数据时，同步检查分享海报链路（`front/utils/share-poster.ts`、
  `kline-poster.ts` 及对应组装函数），详见 `提示词.md`「分享海报同步适配」。

## 小红书文案写作

用户要求以「用户视角」撰写小红书笔记、推荐本小程序时，遵循 `docs/小红书文案规范.md`：
- 功能描述必须对照仓库代码核实，禁止编造功能；
- 代拟体验（使用时长、个人经历等）交付时必须标注「发布前请按真实情况改写」；
- 必须保留免责声明（公开数据、可能有延迟、仅供参考、不构成投资建议）；
- 禁用「稳赚 / 必涨 / 推荐买入 / 带你炒股」等金融诱导词；
- 交付：标题备选 3-4 个 + 正文 + 话题标签 + 配图建议 + 自查清单。
