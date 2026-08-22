# AGENTS.md

本仓库是「市场追踪助手」微信原生小程序（`front/`）+ Spring Boot 后端（`backend-java/`）。

## 修改范围（强制）

- **只允许修改前端代码**，即 `front/` 目录；**禁止修改后端代码**，即 `backend-java/` 目录
  （含 `src/`、`pom.xml`、`Dockerfile`、`scripts/`）。
- 任务需要后端接口或数据变更时，明确指出所需变更，不要自行修改后端。
- 根目录 `提示词.md` 是给 AI 编码助手的提示词，与本文件配合使用。

## 接口变更记录（强制）

后端对外 HTTP 接口（`/api/**`）的每一次**新增 / 修改 / 删除**，都必须同步写入
`docs/每日修改记录/` 目录：**每天一个文件**（`YYYY-MM-DD.md`），当天变更记到当天的文件里。
目录规范见 `docs/每日修改记录/README.md`（含固定分区：新增接口 / 修改接口 / 删除接口 / 备注）。
该目录是接口文档与变更日志的唯一增量来源；完整接口契约见 `docs/API.md`。

## 主题兼容规范（强制，涉及任何 UI 改动时必读）

小程序支持 **浅色 / 深色** 双主题切换，这是核心体验。新增或修改任何页面、组件、样式、Canvas
绘制时，**必须保证两种主题下都可读、风格一致**，禁止只做浅色、切深色后出现白底/黑字、白卡片等
不可读区域。

### 主题机制

- 主题的**单一数据源**是全局 MobX store：`front/stores/settings.store.ts` 的
  `rootStore.settings.theme`（读取/持久化仍走 `front/utils/storage.ts` 的 `getTheme()` / `setTheme()`）。
- 切换主题一律调用 `rootStore.settings.setTheme(theme)`，**不要**直接改 `app.globalData.theme`
  或直接改持久化值，否则其他页面/组件收不到变更；`setTheme` 内部会同步持久化、
  窗口背景（下拉刷新区域，`syncWindowBackground`）与导航栏颜色。
- 页面 / 组件统一用 `front/utils/theme.ts` 的 `bindTheme(target)` / `unbindTheme(target)`
  订阅主题：`bindTheme` 基于 `mobx-miniprogram-bindings` 的 `createStoreBindings` 绑定
  `rootStore.settings.theme`，主题切换会自动刷新 `this.data.theme`，无需在 onShow 手动同步。
- 其他需要全局化的数据（如用户信息 `rootStore.auth.user`、行情数据 `rootStore.market`）通过
  `front/utils/store-bindings.ts` 绑定：页面在 onLoad 用 `registerStoreBinding(this, createStoreBindings(...))`
  （或 `bindGlobalAuth`），onUnload 用 `releaseStoreBindings(this)` 释放。
- 页面根节点必须带 `class="page theme-{{theme}}"`，`app.wxss` 中的 `.page.theme-dark ...`
  规则依赖它生效。

### 新增页面时

1. `data` 中初始化 `theme: rootStore.settings.theme`（来自全局 settings store）；
2. `onLoad` 第一行调用 `bindTheme(this)`，`onUnload` 调用 `unbindTheme(this)`；
3. 不要再用 `onShow` 手动 setData 同步主题（`bindTheme` 的 MobX 绑定会自动同步）；
4. 根节点写 `class="page theme-{{theme}}"`；
5. 页面 wxss 中每个硬编码颜色都要配套 `.page.theme-dark <选择器>` 覆盖（深色值参考下方色板）。

### 新增 / 修改自定义组件时

- **样式隔离**：自定义组件默认 `styleIsolation: 'isolated'`，`app.wxss` / 页面 wxss 的 class
  规则**不会**进入组件内部。组件的深色样式必须写在组件自己的 wxss 里，不要依赖全局深色规则。
- 组件统一声明 `theme: { type: String, value: 'light' }` 属性，并在 `attached` 中
  `this.setData({ theme: getTheme() })` + `bindTheme(this)`，`detached` 中 `unbindTheme(this)`；
- 组件根节点加 `{{theme === 'dark' ? 'dark' : ''}}`（或 `theme-dark`）类，再写配套的
  `.xxx.dark` / `.xxx.theme-dark` 样式块；
- Canvas / 2D 绘制组件（如 `kline-chart`）：绘图配色必须按 `theme` 切换网格线、文字、背景色，
  不能硬编码浅色坐标颜色。

### 色板（保持全局一致）

| 用途         | 浅色                  | 深色                                  |
| ------------ | --------------------- | ------------------------------------- |
| 页面背景     | `#eef3f8` 渐变        | `#111827` 渐变（`#151e2d / #101722`） |
| 卡片表面     | `#ffffff`             | `#1a2637`                             |
| 卡片内嵌表面 | `#f2f6fa`             | `#223248`                             |
| 边框         | `#e2eaf3`             | `#2a394e` / `#34465e`                 |
| 主文字       | `#152338`             | `#f5f7fb`                             |
| 次要文字     | `#718096` / `#99a6b7` | `#e5ebf4` / `#9cacc0`                 |
| 强调蓝       | `#4278ed`             | `#6fa3ff`                             |
| 涨 / 跌      | `#eb514d` / `#20a66a` | 与浅色一致                            |

- 涨跌色、强调色在两种主题下保持一致，只切换明暗；
- 状态徽标（如绿色/紫色 pill）必须同时给出深色变体；
- 下拉刷新 / 回弹背景用 `syncWindowBackground(theme)` 同步，不要只改页面内背景。

### 验收标准

- 在「设置 → 主题模式」切换深浅色后，**所有存活页面、头部、TabBar、卡片、空态、加载态、K线图
  应立即同步**，且没有白底深字、深底浅字不可读的区域；
- 新页面 / 组件合入前，手动切一次深色主题检查对比度与可读性。

## 文案写作任务（小红书笔记等）

用户要求以「用户视角」撰写小红书笔记、推荐本小程序时，遵循 `docs/小红书文案规范.md`
（完整规范），要点：

1. **功能描述必须对照代码核实**：先读 `front/config/tabbar.ts`、`front/pages/*`、`docs/`
   确认功能存在再写；禁止编造不存在的功能（如自选股分组、价格提醒目前没有）。
2. **用户视角是代拟叙事**：涉及使用时长、个人经历、替代其他 APP 等表述，交付时必须标注
   「代拟，发布前请按真实情况改写」，不得默认虚构为事实。
3. **无法核实的信息显式提醒**：小程序是否已上架、微信搜索名称、数据实时性等，
   以「发布前请自行确认」形式提醒用户。
4. **平台合规红线**：禁用「稳赚 / 必涨 / 推荐买入 / 带你炒股」等金融诱导词；
   正文必须保留免责声明（公开接口数据、可能有延迟、仅供参考、不构成投资建议）。
5. **交付物**：标题备选 3-4 个 + 正文 + 话题标签 + 配图建议 + 自查清单。
