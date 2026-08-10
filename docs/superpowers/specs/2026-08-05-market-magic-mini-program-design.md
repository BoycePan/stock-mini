# 市场魔方助手原生小程序设计方案

- 日期：2026-08-05
- 状态：待用户审阅
- 项目：`wx-app-stock`
- 前端目录：`front/`

## 1. 目标与范围

实现一个原生微信小程序前端“市场魔方助手”，视觉和交互以四张参考图为验收基准，使用 TypeScript + MobX，优先接入现有 Go 后端 API；后端暂未提供的数据使用可替换的 mock fallback。

首期包含：

- 全球页：全球经济数据、全球产业数据
- 日韩页：韩国/日本指数与核心产业数据
- 有色页：贵金属、工业金属、其他金属
- AI 页：AI 产业数据、相关板块、股票、新闻
- 设置页：主题、数据说明、协议入口、公众号、缓存和 API 环境信息
- 股票搜索、股票详情、K 线、板块详情、新闻/公告等后端已有能力
- 浅色/深色主题、底部五栏导航、加载/空数据/错误状态

## 2. 数据策略

### 2.1 真实接口优先

当前后端文档 `../../API.md` 已提供：

- 认证：`POST /api/v1/auth/login`、`GET /api/v1/user/profile`
- 股票：搜索、单只行情、批量行情、K 线
- 板块：板块列表、板块 K 线、成分股
- 新闻：通用新闻、个股新闻、个股公告

这些能力全部通过 API 层调用，不在页面组件中直接发起请求。

### 2.2 Mock fallback

当前文档没有提供全球宏观、日韩指数、有色金属和完整 AI 指数接口，因此这些页面先使用 mock 数据。数据访问使用 Provider 抽象：

```text
真实接口存在且返回有效数据 → backend provider
真实接口不存在/返回空数据   → mock provider
请求失败                   → 缓存数据或 mock provider
```

页面显示数据来源状态，避免把 mock 数据伪装成实时行情。

### 2.3 环境配置

接口 host 不写死在页面或业务组件中。统一由环境配置提供：

```ts
// development
apiBaseUrl: 'http://100.90.180.33:8080'
```

请求路径仍集中维护在 `api/` 模块中；生产环境仅替换 `apiBaseUrl`。设置页可选支持本地覆盖 API host，便于局域网调试。

## 3. 工程结构

```text
front/
├── app.ts
├── app.json
├── app.wxss
├── project.config.json
├── package.json
├── tsconfig.json
├── eslint.config.js
├── prettier.config.js
├── config/
│   ├── env.ts
│   ├── env.development.ts
│   └── env.production.ts
├── api/
│   ├── client.ts
│   ├── auth.ts
│   ├── stock.ts
│   ├── sector.ts
│   ├── news.ts
│   └── market.ts
├── stores/
│   ├── auth.store.ts
│   ├── market.store.ts
│   ├── settings.store.ts
│   └── root.store.ts
├── mocks/
│   ├── global-market.ts
│   ├── asia-market.ts
│   ├── metals-market.ts
│   └── ai-market.ts
├── types/
│   ├── api.ts
│   ├── market.ts
│   ├── stock.ts
│   └── user.ts
├── utils/
│   ├── request.ts
│   ├── storage.ts
│   ├── formatter.ts
│   ├── market.ts
│   └── date.ts
├── components/
│   ├── app-header/
│   ├── bottom-tabbar/
│   ├── section-card/
│   ├── market-card/
│   ├── change-value/
│   ├── loading-state/
│   └── empty-state/
└── pages/
    ├── global/
    ├── asia/
    ├── metals/
    ├── ai/
    ├── settings/
    ├── stock-detail/
    ├── sector-detail/
    └── news/
```

## 4. 页面与导航

底部导航对应参考图：

1. 全球
2. 日韩
3. 有色
4. AI
5. 设置

页面统一使用安全区适配和滚动容器。页面头部包含应用标题、分享入口和小程序原生菜单区域，不覆盖微信系统菜单。

### 全球页

- 顶部状态：全球、已更新/数据来源
- 全球经济数据双列卡片：原油、恐慌指数、美元、美债、黄金、白银、铜、天然气
- 全球产业数据双列卡片：AI 算力、CPO、半导体、存储、数据中心、云计算、商业航天、卫星
- 当前使用 mock provider，保留后续真实数据源替换接口

### 日韩页

- 顶部状态：日韩休市/开市
- 韩国综合：KOSPI、KOSDAQ
- 韩国核心产业：存储、半导体、电池、消费电子、互联网、汽车、生物医药、化工材料
- 日本综合：日经225、TOPIX
- 日本核心产业：半导体设备、工业自动化、精密制造、汽车产业链
- 当前使用 mock provider

### 有色页

- 全银：黄金、白银
- 工业金属：铜、铝、锌、镍、锡
- 其他金属：钨、钼、锑、钴、锂
- 当前使用 mock provider

### AI 页

- AI 产业指标和热门概念
- 使用现有板块、股票、新闻 API 组合展示
- 后端数据不足时使用 mock 指标补齐

### 设置页

- 浅色/深色主题切换
- 美股基金估值入口占位
- 数据说明、免责声明、用户协议、隐私政策
- 关注公众号区域
- 数据源和当前 API 环境信息
- 清理本地缓存、重新登录

### 详情页

- 股票详情：实时行情、K 线周期切换、相关新闻、公告
- 板块详情：板块 K 线、成分股、相关新闻
- 新闻列表：通用新闻和个股新闻

## 5. API 与认证设计

### 5.1 API Client

`api/client.ts` 负责：

- 拼接环境 base URL 与 API path
- 设置超时
- 自动添加 `Authorization: Bearer <token>`
- 解包 `{ code, msg, data }`
- 处理后端业务错误码
- 处理 token 失效并清理登录状态
- 统一网络异常
- 控制重复请求和必要的重试

页面只调用语义化 API：

```ts
stockApi.getQuote('000001')
sectorApi.getBoards(20)
newsApi.getFeed(20)
```

### 5.2 微信登录

```text
wx.login()
  → POST /api/v1/auth/login
  → 保存 token 与用户信息
  → 后续请求自动带 Bearer token
```

token 放入小程序本地存储，退出登录时清理。登录接口失败时页面提供明确的重试入口。

## 6. 状态管理

### AuthStore

- token
- 当前用户
- 是否登录
- 微信登录、退出登录、刷新用户
- token 失效处理

### MarketStore

- 当前导航 tab
- 全球、日韩、有色、AI 数据
- loading/error/lastUpdated
- `backend | mock | cache` 数据来源
- 下拉刷新

### SettingsStore

- 主题模式
- 自定义 API host
- 是否启用 mock fallback
- 首次启动状态

MobX store 与页面通过 `mobx-miniprogram-bindings` 连接，组件只负责展示和事件转发。

## 7. 视觉系统

### 颜色

```text
页面背景：#F3F6FA
卡片背景：#FFFFFF
次级卡片：#F7F8FA
正文：#17191D
次级文字：#667085
边框：#E4E8EE
上涨红色：#F04B45
下跌绿色：#2DB653
全球橙色：#FF8245
日韩蓝色：#4C8DFF
有色珊瑚色：#FF625F
AI 紫色：#8368F5
```

### 组件规则

- 统一大圆角白色卡片
- 使用轻边框和低强度阴影区分层级
- 数据卡片默认双列网格
- 数值字号大于标签字号
- 涨跌方向使用上/下三角形
- 中国市场语境采用红涨绿跌
- 主题切换使用 CSS 变量
- 组件不依赖外部 UI 框架，控制包体积

## 8. 状态与异常

所有数据页面必须支持：

- 首次加载
- 下拉刷新
- 请求中
- 真实接口数据
- mock 数据
- 缓存数据
- 空数据
- 网络失败
- token 失效
- 后端业务错误
- 深色模式
- 超长文本和异常数值

mock 或缓存数据展示来源标识，例如：`示例数据 · 等待数据源接入`。

## 9. 实施顺序

1. 创建原生小程序工程和 TypeScript 配置
2. 根据 npm registry 校验依赖版本并生成 package.json
3. 建立环境配置、请求层、响应类型和存储工具
4. 建立 MobX stores 和认证流程
5. 建立主题、底部导航和公共数据组件
6. 接入股票、板块、新闻 API
7. 实现全球、日韩、有色、AI 页面和 mock fallback
8. 实现设置页和详情页
9. 增加加载、错误、空数据和缓存状态
10. 运行 TypeScript、ESLint、格式化检查
11. 补充前端 README、开发环境说明和 API 配置说明

## 10. 验收标准

- `front/` 可以被微信开发者工具打开
- 开发环境 API host 可配置为 `http://100.90.180.33:8080`
- 页面业务代码不直接写死 API host
- 登录后 token 可持久化并自动鉴权
- 现有后端接口能驱动股票、板块、新闻相关页面
- 缺少后端接口的模块能使用 mock fallback 正常展示
- 四张参考图的页面布局、颜色、卡片和底部导航得到还原
- 浅色/深色主题可切换
- 页面具备加载、失败、空数据、mock 来源提示
- TypeScript 和 ESLint 检查通过
