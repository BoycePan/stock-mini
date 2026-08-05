import type { MarketPageData } from '../types/market'

export function getGlobalMarketMock(): MarketPageData {
  return {
    statusLabel: '全球',
    statusTone: 'active',
    updatedLabel: '已更新 · 示例数据',
    source: 'mock',
    sections: [
      {
        id: 'global-economy',
        title: '全球经济数据',
        tone: 'global',
        metrics: [
          { id: 'brent', name: '布伦特原油', value: '78.95', change: -0.52 },
          { id: 'vix', name: '恐慌指数', value: '19.02', change: -0.36 },
          { id: 'dxy', name: '美元强弱', value: '99.66', change: -0.09 },
          { id: 'bond', name: '美债长债', value: '82.98', change: 0.21 },
          { id: 'gold', name: '黄金盘司', value: '4273.51', change: 3.86 },
          { id: 'silver', name: '白银盘司', value: '62.39', change: 4.21 },
          { id: 'copper', name: '铜', value: '667.86', change: 0.53 },
          { id: 'gas', name: '天然气', value: '2.666', change: -0.6 },
        ],
      },
      {
        id: 'global-industry',
        title: '全球产业数据',
        tone: 'global',
        badge: '美股盘中',
        metrics: [
          { id: 'ai', name: 'AI算力', value: '', change: -1.61, icon: '🧠' },
          { id: 'cpo', name: 'CPO', value: '', change: -0.08, icon: '💡' },
          { id: 'semi', name: '半导体', value: '', change: -1.88, icon: '🔬' },
          { id: 'storage', name: '存储', value: '', change: 1.59, icon: '💾' },
          { id: 'data-center', name: '数据中心', value: '', change: -0.57, icon: '🗄️' },
          { id: 'cloud', name: '云计算', value: '', change: -0.07, icon: '☁️' },
          { id: 'space', name: '商业航天', value: '', change: -2.16, icon: '🚀' },
          { id: 'satellite', name: '卫星', value: '', change: -3.19, icon: '🛰️' },
        ],
      },
    ],
  }
}
