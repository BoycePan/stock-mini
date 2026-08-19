/**
 * 金店金价配置 —— 品牌 → 品类 → 行情代码（JO_xxxxx）。
 *
 * 数据源：金投网实物黄金价格页 https://quote.cngold.org/gjs/swhj.html（2026-08-19 核对）。
 * 价格由 https://api.jijinhao.com/quoteCenter/realTime.htm 实时返回（免费、无 Key）。
 *
 * ⚠️ 域名白名单：生产环境需在「微信公众平台 → 开发 → 开发管理 → 服务器域名 → request 合法域名」
 * 添加 https://api.jijinhao.com（与 qt.gtimg.cn / hq.sinajs.cn 同理）。开发态 devtools
 * 已配置 urlCheck=false 可不校验。
 */

/** 单品牌的一个品类（如 周大福 的 黄金价格） */
export interface GoldShopItemConfig {
  item: string
  code: string
}

/** 品牌目录：全部 42 家（品类顺序即展示优先级，黄金价在前） */
export const GOLD_SHOP_CATALOG: Record<string, GoldShopItemConfig[]> = {
  周大福: [
    { item: '黄金价格', code: 'JO_42660' },
    { item: '铂金价格', code: 'JO_42661' },
    { item: '金条金价(内地)', code: 'JO_56037' },
  ],
  老凤祥: [
    { item: '黄金价格', code: 'JO_42657' },
    { item: '铂金价格', code: 'JO_42658' },
    { item: '足金价格', code: 'JO_42659' },
  ],
  周六福: [
    { item: '黄金价格', code: 'JO_42653' },
    { item: '铂金价格', code: 'JO_42654' },
    { item: '金条价格', code: 'JO_42656' },
  ],
  周生生: [
    { item: '黄金价格', code: 'JO_42625' },
    { item: '铂金价格', code: 'JO_42626' },
    { item: '金条价格(内地)', code: 'JO_56045' },
  ],
  六福珠宝: [
    { item: '黄金价格', code: 'JO_42646' },
    { item: '铂金价格', code: 'JO_42647' },
    { item: '金条价格(内地)', code: 'JO_56041' },
  ],
  梦金园: [
    { item: '黄金价格', code: 'JO_351126' },
    { item: '铂金价格', code: 'JO_351237' },
    { item: '金条价格', code: 'JO_351239' },
  ],
  老庙: [
    { item: '黄金价格', code: 'JO_42634' },
    { item: '铂金价格', code: 'JO_42635' },
    { item: '金条/金块价格', code: 'JO_42637' },
  ],
  金至尊: [
    { item: '黄金价格', code: 'JO_42632' },
    { item: '铂金价格', code: 'JO_42633' },
    { item: '首饰', code: 'JO_42668' },
  ],
  菜百: [
    { item: '黄金价格', code: 'JO_42638' },
    { item: '铂金价格', code: 'JO_42639' },
    { item: '基础银价', code: 'JO_95014' },
  ],
  中国黄金: [
    { item: '基础金价', code: 'JO_52683' },
    { item: '零售价', code: 'JO_52684' },
    { item: '回收价', code: 'JO_52685' },
  ],
  周大生: [
    { item: '黄金价格', code: 'JO_52678' },
    { item: '铂金价格', code: 'JO_52677' },
    { item: '金条价格', code: 'JO_351256' },
  ],
  潮宏基: [
    { item: '黄金价格', code: 'JO_52670' },
    { item: '铂金价格', code: 'JO_61954' },
    { item: '金条价格', code: 'JO_351254' },
  ],
  宝庆银楼: [
    { item: '黄金价格', code: 'JO_52674' },
    { item: '铂金价格', code: 'JO_52673' },
  ],
  太阳金店: [
    { item: '黄金价格', code: 'JO_52676' },
    { item: '铂金价格', code: 'JO_52675' },
  ],
  齐鲁金店: [
    { item: '黄金价格', code: 'JO_52680' },
    { item: '铂金价格', code: 'JO_52679' },
  ],
  亚一金店: [
    { item: '黄金价格', code: 'JO_52672' },
    { item: '铂金价格', code: 'JO_52671' },
    { item: '金条价格', code: 'JO_351255' },
  ],
  高赛尔: [
    { item: '金条', code: 'JO_52681' },
    { item: '银条', code: 'JO_52682' },
  ],
  千禧之星: [
    { item: '黄金价格', code: 'JO_52686' },
    { item: '铂金价格', code: 'JO_54155' },
  ],
  吉盟珠宝: [
    { item: '黄金价格', code: 'JO_52689' },
    { item: '铂金价格', code: 'JO_54372' },
  ],
  东祥金店: [
    { item: '黄金价格', code: 'JO_52692' },
    { item: '铂金价格', code: 'JO_52693' },
  ],
  萃华金店: [
    { item: '黄金价格', code: 'JO_52694' },
    { item: '铂金价格', code: 'JO_52695' },
  ],
  百泰黄金: [
    { item: '黄金价格', code: 'JO_52696' },
    { item: '金条价格', code: 'JO_61908' },
  ],
  金象珠宝: [{ item: '黄金价格', code: 'JO_52698' }],
  常州金店: [
    { item: '黄金价格', code: 'JO_52699' },
    { item: '铂金价格', code: 'JO_52700' },
  ],
  扬州金店: [
    { item: '黄金价格', code: 'JO_52702' },
    { item: '铂金价格', code: 'JO_52701' },
  ],
  嘉华珠宝: [{ item: '黄金价格', code: 'JO_52703' }],
  福泰珠宝: [
    { item: '黄金价格', code: 'JO_52705' },
    { item: '铂金价格', code: 'JO_52704' },
  ],
  城隍珠宝: [
    { item: '黄金价格', code: 'JO_52707' },
    { item: '铂金价格', code: 'JO_52706' },
  ],
  星光达珠宝: [
    { item: '黄金价格', code: 'JO_52709' },
    { item: '铂金价格', code: 'JO_52708' },
  ],
  金兰首饰: [
    { item: '黄金价格', code: 'JO_52711' },
    { item: '铂金价格', code: 'JO_52712' },
  ],
  金银街: [
    { item: '投资金条', code: 'JO_61906' },
    { item: '工艺金条', code: 'JO_61905' },
    { item: '千足金首饰', code: 'JO_61428' },
  ],
  多边金都珠宝: [
    { item: '千足金饰品', code: 'JO_63849' },
    { item: '3D硬金', code: 'JO_63851' },
    { item: '精品挂件', code: 'JO_63850' },
  ],
  富艺珠宝: [
    { item: '黄金价格', code: 'JO_92438' },
    { item: '投资金条', code: 'JO_92441' },
    { item: 'PT950铂金', code: 'JO_92439' },
  ],
  天乙银饰: [{ item: '白银价格', code: 'JO_95167' }],
  斯尔沃银器: [{ item: '白银基价', code: 'JO_95168' }],
  中钞国鼎: [{ item: '基准银价', code: 'JO_95169' }],
  K金: [
    { item: '9K金', code: 'JO_339765' },
    { item: '14K金', code: 'JO_339767' },
    { item: '18K金', code: 'JO_339769' },
  ],
  莱音珠宝: [
    { item: '黄金价格', code: 'JO_321446' },
    { item: '铂金价格', code: 'JO_321448' },
    { item: '金条价格', code: 'JO_321450' },
  ],
  金大福: [
    { item: '黄金价格', code: 'JO_52687' },
    { item: '铂金价格', code: 'JO_52688' },
  ],
  明牌珠宝: [
    { item: '黄金价格', code: 'JO_344211' },
    { item: '铂金价格', code: 'JO_348752' },
  ],
  水贝黄金: [
    { item: '黄金价格', code: 'JO_346627' },
    { item: '铂金价格', code: 'JO_346628' },
    { item: '金条价格', code: 'JO_346629' },
  ],
  胖东来珠宝: [
    { item: '东来赤金', code: 'JO_351130' },
    { item: '足金金条', code: 'JO_351131' },
    { item: '足金饰品(普通工艺)', code: 'JO_351132' },
  ],
}

/**
 * 页面展示的品牌（足金饰品零售价），按知名度筛选排序。
 * 新增品牌：在 GOLD_SHOP_CATALOG 里有即可，无需改这里（展示全部品牌会过长）。
 */
export const GOLD_SHOP_BRANDS: string[] = [
  '周大福',
  '老凤祥',
  '周六福',
  '周生生',
  '六福珠宝',
  '老庙',
  '菜百',
  '中国黄金',
  '周大生',
  '潮宏基',
  '金至尊',
  '明牌珠宝',
  '梦金园',
  '亚一金店',
  '水贝黄金',
]

/** 一次请求拉全目录所需代码（去重、保持稳定顺序） */
export function goldShopAllCodes(): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  for (const configs of Object.values(GOLD_SHOP_CATALOG)) {
    for (const { code } of configs) {
      if (!seen.has(code)) {
        seen.add(code)
        codes.push(code)
      }
    }
  }
  return codes
}

/**
 * 品类展示优先级（选中「足金/零售」口径展示，避免落到铂金/回收价）。
 * 中国黄金无「黄金价格」，取「零售价」；高赛尔无足金，取「投资金条」。
 */
const ITEM_PRIORITY = [
  '黄金价格',
  '足金价格',
  '足金饰品(普通工艺)',
  '足金金条',
  '零售价',
  '基础金价',
  '投资金条',
  '千足金饰品',
  '千足金首饰',
  '东来赤金',
]

/** 品类 → 卡片上展示的短标签（太长会撑坏卡片） */
export function goldShopItemLabel(item: string): string {
  switch (item) {
    case '黄金价格':
    case '足金价格':
      return '足金'
    case '足金饰品(普通工艺)':
      return '足金饰品'
    case '足金金条':
      return '足金金条'
    case '零售价':
      return '零售'
    case '基础金价':
      return '基础金价'
    case '投资金条':
      return '投资金条'
    case '千足金饰品':
    case '千足金首饰':
      return '千足金'
    case '东来赤金':
      return '东来赤金'
    case '铂金价格':
      return '铂金'
    case '金条':
    case '金条价格':
    case '金条价格(内地)':
    case '金条金价(内地)':
    case '金条/金块价格':
      return '金条'
    default:
      return item
  }
}

/** 按优先级为某品牌挑选要展示的品类（返回 null 表示该品牌无有效报价） */
export function pickGoldShopItem(
  configs: GoldShopItemConfig[],
  quotesByCode: Map<string, GoldShopQuoteLike>,
): GoldShopQuoteLike | null {
  for (const preferred of ITEM_PRIORITY) {
    const config = configs.find((c) => c.item === preferred)
    if (config) {
      const quote = quotesByCode.get(config.code)
      if (quote && quote.price > 0) return quote
    }
  }
  // 兜底：任取一个有价的品类
  for (const { code } of configs) {
    const quote = quotesByCode.get(code)
    if (quote && quote.price > 0) return quote
  }
  return null
}

/** 与 api/gold-shop.ts 的 GoldShopQuote 结构对齐（避免循环依赖用的最小形状） */
export interface GoldShopQuoteLike {
  code: string
  price: number
  pct: number
  item: string
  /** 行情时间（epoch 毫秒），用于展示条目更新时间 */
  time: number
}
