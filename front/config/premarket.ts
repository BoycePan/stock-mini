/**
 * 美股盘前行情 Demo 标的配置（纯前端，临时演示用）。
 *
 * 数据源：东方财富 ulist.np/get（美国市场，fltt=2 十进制）。
 * 美股 secid 市场号沿用仓库既有口径（见 config/tabbar.ts 注释）：
 *   100 = 全球/美股指数（环球指数）、105 = 纳斯达克、106 = 纽交所、107 = 美交所。
 * 盘前时段（美东 04:00–09:30 / 夏令时对应北京 16:00–21:30）东财 f2 即盘前价、f3 即相对昨收的盘前涨跌幅。
 */

export interface PremarketItem {
  /** 东方财富 secid（market.code） */
  secid: string
  /** 展示名称（优先展示东财返回的中文名，失败回退此值） */
  name: string
  /** 展示图标（Emoji） */
  icon?: string
  /**
   * 分时取数代码（可选）：命中时点击卡片可进入对应分时页（复用既有 minute 源）。
   * 缺省时点击卡片仅提示暂无分时。
   */
  minuteCode?: string
}

/** 美股三大指数（东财环球指数 100 市场） */
export const PREMARKET_INDICES: PremarketItem[] = [
  { secid: '100.DJIA', name: '道琼斯', icon: '🏛️', minuteCode: 'usDJI' },
  { secid: '100.SPX', name: '标普500', icon: '📈', minuteCode: 'usINX' },
  { secid: '100.NDX', name: '纳斯达克', icon: '🚀', minuteCode: 'usIXIC' },
]

/** 热门美股 / 中概（科技 + 半导体 + 中概股，A 股用户关注度较高） */
export const PREMARKET_STOCKS: PremarketItem[] = [
  { secid: '105.NVDA', name: '英伟达', icon: '🔬' },
  { secid: '105.AAPL', name: '苹果', icon: '🍎' },
  { secid: '105.MSFT', name: '微软', icon: '🪟' },
  { secid: '105.GOOGL', name: '谷歌', icon: '🔎' },
  { secid: '105.AMZN', name: '亚马逊', icon: '📦' },
  { secid: '105.META', name: 'Meta', icon: '👥' },
  { secid: '105.TSLA', name: '特斯拉', icon: '🚗' },
  { secid: '105.AMD', name: '超威半导体', icon: '💻' },
  { secid: '105.PDD', name: '拼多多', icon: '🛒' },
  { secid: '106.BABA', name: '阿里巴巴', icon: '🏢' },
]
