import type { AppRouteEvent } from './tracking'

/** 全球指数列表项（GET /api/v1/index/list） */
export interface GlobalIndex {
  code: string
  name: string
  market: string
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 全球板块列表项（GET /api/v1/global-sector/list） */
export interface GlobalSector {
  code: string
  name: string
  market: string
  board: 'industry' | 'theme'
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 全球资产列表项（GET /api/v1/asset/list），type 为 commodity/forex/crypto/bond/stock */
export interface GlobalAsset {
  code: string
  name: string
  type: 'commodity' | 'forex' | 'crypto' | 'bond' | 'us-stock' | string
  market: string
  board: string
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 实时行情（GET /api/v1/{index|global-sector|asset}/{code}/quote） */
export interface GlobalQuote {
  symbol: string
  price: number
  currency?: string
  exchange?: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- 对 miniprogram-api-typings 的命名空间做接口合并，必须用 namespace 语法
  namespace WechatMiniprogram {
    interface Wx {
      /**
       * wx.onAppRoute（基础库 2.4.4+）：监听小程序路由变化，覆盖 navigateTo / switchTab /
       * reLaunch / redirectTo 全路由。miniprogram-api-typings 未收录，这里补充声明；
       * 低版本基础库无此接口时调用方用 typeof 判空跳过（自动 PV 退化为 App.onShow 兜底）。
       */
      onAppRoute?(listener: (res: AppRouteEvent) => void): void
    }
  }
}
