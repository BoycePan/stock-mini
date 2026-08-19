/**
 * 实物黄金价格配置 —— 上海黄金交易所（SGE）现货品种 → 行情代码（JO_xxxxx）。
 *
 * 数据源：金投网上海黄金交易所行情页 https://quote.cngold.org/gjs/jjs.html
 * （2026-08-19 核对），价格由 https://api.jijinhao.com/quoteCenter/realTime.htm 实时返回，
 * 与金店金价（front/config/gold-shop.ts）同源同接口。
 *
 * 「黄金9999」(Au99.99) 为实物黄金基准价，是金店零售价的定价基础。
 * 单位：黄金/铂金 元/克，白银 元/千克（白银T+D 实测 ~16000，注意单位差异）。
 */

export interface PhysicalGoldItemConfig {
  /** 品种名（如 黄金9999） */
  name: string
  /** 金投网行情代码 */
  code: string
  /** 价格区间校验 [min, max]（防上游异常快照污染展示） */
  min: number
  max: number
  /** 单位；非「元/克」的品种（如白银 元/千克）在卡片上加单位标签 */
  unit?: string
}

/** SGE 实物黄金展示品种（按重要性排序；T+N/国际板等小众品种不展示） */
export const PHYSICAL_GOLD_CATALOG: PhysicalGoldItemConfig[] = [
  { name: '黄金9999', code: 'JO_71', min: 400, max: 1500, unit: '元/克' },
  { name: '黄金9995', code: 'JO_70', min: 400, max: 1500, unit: '元/克' },
  { name: '金条100g', code: 'JO_73', min: 400, max: 1500, unit: '元/克' },
  { name: '金条50g', code: 'JO_72', min: 400, max: 1500, unit: '元/克' },
  { name: '黄金T+D', code: 'JO_9753', min: 400, max: 1500, unit: '元/克' },
  { name: 'm黄金T+D', code: 'JO_92226', min: 400, max: 1500, unit: '元/克' },
  { name: '铂金9995', code: 'JO_74', min: 150, max: 800, unit: '元/克' },
  { name: '白银T+D', code: 'JO_9754', min: 3000, max: 30000, unit: '元/千克' },
]

/** 一次请求所需的全部代码 */
export function physicalGoldCodes(): string[] {
  return PHYSICAL_GOLD_CATALOG.map((item) => item.code)
}
