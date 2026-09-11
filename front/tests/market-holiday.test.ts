import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAStockPhase,
  getMarketSession,
  getRegionStatus,
  isAStockTradingDay,
  isMarketHoliday,
} from '../utils/market-clock.ts'

/**
 * A股法定节假日判定的一致性回归。
 *
 * 历史缺陷：getAStockPhase / isAStockTradingDay 只判周末、不查 MARKET_HOLIDAYS.cn，
 * 而同文件的 getRegionStatus（cn 分支）与 getUsPhase 都查。后果是同一屏自相矛盾——
 * 国庆 / 春节等工作日节假日盘中时段，页头与板块胶囊显示「A股盘中 · active」，
 * 而 A股指数分区显示「休市」；有色页还会按已休市的内盘口径取价。
 */

/** 以 UTC 时刻构造 Date（各市场本地时间由被测函数换算） */
const at = (iso: string): Date => new Date(iso)

/** 2026-10-01（周四，国庆）北京时间 10:00 —— 工作日 + 盘中时段 + 法定节假日 */
const NATIONAL_DAY_10AM = at('2026-10-01T02:00:00Z')
/** 2026-09-30（周三，非节假日）北京时间 10:00 —— 同上时刻但正常交易 */
const NORMAL_WEDNESDAY_10AM = at('2026-09-30T02:00:00Z')

test('A股节假日（2026-10-01 周四）盘中时段判为休市，与 getRegionStatus 同源', () => {
  // 前置校验：确认夹具本身是「工作日 + 已维护的法定节假日」，否则用例失去意义
  assert.equal(new Date(Date.UTC(2026, 9, 1)).getUTCDay(), 4, '2026-10-01 应为周四')
  assert.equal(isMarketHoliday('cn', NATIONAL_DAY_10AM), true, '2026-10-01 应在 cn 节假日日历中')

  assert.equal(getAStockPhase(NATIONAL_DAY_10AM), 'closed')
  assert.equal(isAStockTradingDay(NATIONAL_DAY_10AM), false)
  // 与指数分区卡片的状态胶囊保持一致（此前会给出 open/active）
  assert.equal(getRegionStatus('cn', NATIONAL_DAY_10AM).kind, 'closed')
  // 会话口径：节假日不得判定为 A股盘中（此前 useA 为 true）
  assert.equal(getMarketSession(NATIONAL_DAY_10AM).useA, false)
})

test('A股相邻工作日同一时刻仍正常判为早盘（过度拦截防护）', () => {
  assert.equal(isMarketHoliday('cn', NORMAL_WEDNESDAY_10AM), false)
  assert.equal(getAStockPhase(NORMAL_WEDNESDAY_10AM), 'morning')
  assert.equal(isAStockTradingDay(NORMAL_WEDNESDAY_10AM), true)
  assert.equal(getRegionStatus('cn', NORMAL_WEDNESDAY_10AM).kind, 'open')
  assert.equal(getMarketSession(NORMAL_WEDNESDAY_10AM).useA, true)
})

test('节假日判定只影响交易日口径，不影响非交易时段的既有语义', () => {
  // 节假日当天 08:00（盘前空档）与 16:00（收盘后）同样为休市，不因新增判断而变化
  assert.equal(getAStockPhase(at('2026-10-01T00:00:00Z')), 'closed')
  assert.equal(getAStockPhase(at('2026-10-01T08:00:00Z')), 'closed')
  // 未维护年份（如 2030）回退为「仅按周末判定」，此时工作日盘中仍应为早盘
  assert.equal(getAStockPhase(at('2030-10-01T02:00:00Z')), 'morning')
})
