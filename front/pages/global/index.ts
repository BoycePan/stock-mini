import { createMarketPage } from '../../utils/market-page-factory'

createMarketPage({
  pageKey: 'global',
  loadingText: '正在加载全球行情',
  loadingDesc: '正在为您同步全球主要市场最新数据，请稍候…',
  enableShare: true,
})
