import type { MarketPageData } from '../types/market'

const metrics = (items: Array<[string, number]>) =>
  items.map(([name, change], index) => ({ id: `asia-${index}`, name, value: '', change }))

export function getAsiaMarketMock(): MarketPageData {
  return {
    statusLabel: '日韩 休市',
    statusTone: 'rest',
    updatedLabel: '示例数据',
    source: 'mock',
    sections: [
      {
        id: 'korea-index',
        title: '韩国综合',
        tone: 'asia',
        metrics: metrics([
          ['KOSPI', 3.76],
          ['KOSDAQ', 2.42],
        ]),
      },
      {
        id: 'korea-industry',
        title: '韩国核心产业数据',
        tone: 'asia',
        metrics: metrics([
          ['存储', 2.5],
          ['半导体', 5.77],
          ['电池', 2.13],
          ['消费电子', 8.46],
          ['互联网', 1.1],
          ['汽车', 3.06],
          ['生物医药', 2.42],
          ['化工材料', -0.39],
        ]),
      },
      {
        id: 'japan-index',
        title: '日本综合',
        tone: 'asia',
        metrics: metrics([
          ['日经225', -0.9],
          ['TOPIX', 2.13],
        ]),
      },
      {
        id: 'japan-industry',
        title: '日本核心产业数据',
        tone: 'asia',
        metrics: metrics([
          ['半导体设备', 3.26],
          ['工业自动化', 4.41],
          ['精密制造', 5.4],
          ['汽车产业链', -0.14],
        ]),
      },
    ],
  }
}
