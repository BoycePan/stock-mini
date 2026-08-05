import type { MarketPageData } from '../types/market'

export function getAiMarketMock(): MarketPageData {
  return {
    statusLabel: 'AI',
    statusTone: 'active',
    updatedLabel: '已更新 · 组合数据',
    source: 'mock',
    sections: [
      {
        id: 'ai-index',
        title: 'AI 产业指数',
        tone: 'ai',
        metrics: [
          { id: 'compute', name: 'AI 算力', value: '1286.42', change: 1.86, icon: '🧠' },
          { id: 'model', name: '大模型', value: '964.18', change: 0.92, icon: '✨' },
          { id: 'robot', name: '智能机器人', value: '812.03', change: -0.31, icon: '🤖' },
          { id: 'vision', name: '机器视觉', value: '738.11', change: 1.24, icon: '👁️' },
        ],
      },
      {
        id: 'ai-concepts',
        title: '热门 AI 概念',
        tone: 'ai',
        metrics: [
          { id: 'cpo', name: 'CPO', value: '', change: 2.16, icon: '💡' },
          { id: 'server', name: '服务器', value: '', change: 1.47, icon: '🖥️' },
          { id: 'chip', name: 'AI 芯片', value: '', change: 0.88, icon: '🔲' },
          { id: 'agent', name: 'AI Agent', value: '', change: -0.42, icon: '⚡' },
        ],
      },
    ],
  }
}
