import type { MarketPageData } from '../types/market'

const metric = (name: string, change: number, index: number) => ({
  id: `metal-${index}`,
  name,
  value: '',
  change,
})

export function getMetalsMarketMock(): MarketPageData {
  return {
    statusLabel: '有色',
    statusTone: 'active',
    updatedLabel: '已更新 · 示例数据',
    source: 'mock',
    sections: [
      {
        id: 'precious',
        title: '全银',
        tone: 'metals',
        metrics: [metric('黄金', 3.75, 0), metric('白银', 3.96, 1)],
      },
      {
        id: 'industrial',
        title: '工业金属',
        tone: 'metals',
        metrics: [
          metric('铜', 0.54, 2),
          metric('铝', 0.13, 3),
          metric('锌', 1.03, 4),
          metric('镍', -0.92, 5),
          metric('锡', 1.19, 6),
        ],
      },
      {
        id: 'other',
        title: '其他金属',
        tone: 'metals',
        metrics: [
          metric('钨', 0.76, 7),
          metric('钼', 6.67, 8),
          metric('锑', 10, 9),
          metric('铟', 9.58, 10),
          metric('锂', 3.71, 11),
        ],
      },
    ],
  }
}
