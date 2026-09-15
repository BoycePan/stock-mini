export type MarketTone = 'global' | 'asia' | 'metals' | 'finance'

export interface MarketMetric {
  id: string
  /** 行情代码（如 sh000001 / KS11 / GOLD），用于卡片点击查看日K时定位数据源；新闻等无行情条目缺省 */
  code?: string
  /**
   * 分时取数专用代码：与展示 code 不同（随会话切换口径，如 外盘 GOLD → GOLD-US 取现货 XAUUSD 分时）。
   * 缺省时直接用 code 取分时；无对应源时该卡片不显示「分时」入口。
   */
  minuteCode?: string
  /** 无分时源时点击卡片的提示文案（覆盖默认「该指标暂无分时数据」） */
  minuteUnavailableTip?: string
  name: string
  value: string
  change: number
  unit?: string
  icon?: string
  /**
   * 指标名称旁图标图片路径（本地静态图，如 /static/icons/...）。
   * 有值时优先于 icon（Emoji）渲染；无值时回退 icon。
   */
  iconImage?: string
  /** 指标名称旁的小徽标（如「个股」、代表金属「钼」），按序展示 */
  tags?: string[]
  updatedAt?: string
  /** 无涨跌幅（缺失或恰好为 0）时隐藏涨跌徽标，避免展示无意义的「— —」 */
  hideChange?: boolean
  /** 不出现在分享海报中（如「市值TOP100」入口卡，海报里无行情语义） */
  hideFromPoster?: boolean
  /** 特殊入口卡：以整行渐变横幅渲染（区别于普通行情卡片，见 section-card） */
  featured?: boolean
  /** 特殊入口卡的副标题（如「美股三大市场 · 市值前100个股」） */
  featuredDesc?: string
  /**
   * 入口卡跳转目标列表页时预选的初始 tab（如 首页板块区入口 → industry-all 页：
   * 首页展示 A股板块口径 → 概念板块；美股口径 → 美股概念，见 api/market.ts 入口构建）。
   * 仅特殊入口卡使用，普通行情条目缺省。
   */
  initialTab?: string
  /** 点击查看详情时透传的扩展数据（如新闻标题/摘要/原文链接） */
  detail?: Record<string, string | undefined>
}

/**
 * 面板内 Tab（如首页「行业板块」按市场分 A股 / 美股）：数据层为每个 Tab 备好该市场的指标
 * 与展示元信息，页面按当前选中 Tab 把它们投影到分区字段（metrics / marketStatus /
 * minuteCorner 等），渲染层只需渲染 Tab 条 + 投影结果。
 */
export interface MarketSectionTab {
  /** Tab 键（如 'a' / 'us'）：时段默认选中与用户手动切换都以此标识 */
  key: string
  /** Tab 标签（如 A股 / 美股） */
  label: string
  /**
   * 该 Tab 的指标列表（数据层构建）。页面投影到 section.metrics 后不再下发渲染层
   * （避免另一市场的整份数据重复 setData），故渲染数据里缺省。
   */
  metrics?: MarketMetric[]
  /** 该 Tab 的盘面状态文案（A股 → 大A盘中/午间休市/休市；美股 → 美股盘前/盘中/盘后/休市） */
  marketStatus?: string
  /**
   * 该 Tab 的盘面状态**短文案**（盘中 / 午休 / 盘前 / 盘后 / 集合竞价 / 休市）：
   * 展示在 Tab 上（Tab 标签已写明市场名，不必再重复「大A盘中 / 美股盘中」里的市场前缀）；
   * 由 utils/market-clock.ts industryPhaseShort 从市场阶段推导，与阶段胶囊同源、同色调。
   */
  marketStatusShort?: string
  /** 该 Tab 的盘面状态色调 */
  marketTone?: 'active' | 'quiet' | 'rest'
  /** 该 Tab 是否以面板右上角单个「分时」角标提示（美股盘前无分时图 → false） */
  minuteCorner?: boolean
}

export interface MarketSection {
  id: string
  title: string
  tone: MarketTone
  badge?: string
  /** 有值时标题右侧显示「i」说明图标，点击弹窗展示该提示文案 */
  tip?: string
  tipTitle?: string
  metrics: MarketMetric[]
  /** 单行布局：无价格条目（如行业板块只有涨跌幅）时，名称与涨跌幅并排一行展示 */
  singleLine?: boolean
  /**
   * 整个面板右上角以单个「分时」角标提示（如行业板块），
   * 代替逐卡片内联「分时」标签；仅在该面板内指标支持分时图时置 true。
   */
  minuteCorner?: boolean
  /** 标题右侧盘面状态文案（如 盘中 / 午休 / 盘后 / 集合竞价 / 休市），仅部分市场板块展示 */
  marketStatus?: string
  /** 盘面状态色调：active=盘中 / quiet=盘后午休集合竞价等 / rest=休市 */
  marketTone?: 'active' | 'quiet' | 'rest'
  /**
   * 面板内 Tab 列表（如行业板块的 A股 / 美股）：有值时标题下方渲染切换条，
   * 上面的 metrics / marketStatus / minuteCorner 等字段恒为**当前选中 Tab** 的投影结果。
   */
  tabs?: MarketSectionTab[]
  /**
   * 当前选中 Tab 键（与 tabs 配对）：数据层给的是**按时段规则判定的默认值**
   * （如首页行业板块见 api/market.ts resolveIndustrySource），用户手动切换由
   * stores/market.store.ts 的 pickSectionTab 覆盖后投影回来。
   */
  activeTab?: string
}

export interface MarketPageData {
  statusLabel: string
  statusTone: 'active' | 'rest'
  updatedLabel: string
  sections: MarketSection[]
}
