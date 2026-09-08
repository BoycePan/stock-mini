import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ashareEmSecid,
  ashareTcCode,
  hasMinuteSources,
  resolveMinuteSources,
} from '../config/minute.ts'
import { resolveMinuteSession } from '../utils/minute-session.ts'

// ---------------------------------------------------------------------------
// A股个股代码互转（config/minute.ts ashareTcCode / ashareEmSecid）
// ---------------------------------------------------------------------------

test('ashareTcCode：A股裸代码 → 腾讯行情前缀 code（6→sh；4/8/92→bj；其余→sz）', () => {
  assert.equal(ashareTcCode('603679'), 'sh603679')
  assert.equal(ashareTcCode('600519'), 'sh600519')
  assert.equal(ashareTcCode('688135'), 'sh688135') // 科创板仍为 sh
  assert.equal(ashareTcCode('000001'), 'sz000001')
  assert.equal(ashareTcCode('300911'), 'sz300911')
  assert.equal(ashareTcCode('920010'), 'bj920010') // 北交所新代码
  assert.equal(ashareTcCode('830799'), 'bj830799') // 北交所老代码
})

test('ashareEmSecid：腾讯 code → 东财 secid（sh→1.，sz/bj→0.）', () => {
  assert.equal(ashareEmSecid('sh600519'), '1.600519')
  assert.equal(ashareEmSecid('sz000001'), '0.000001')
  assert.equal(ashareEmSecid('bj920010'), '0.920010')
})

// ---------------------------------------------------------------------------
// A股个股分时源兜底（resolveMinuteSources，板块成分股弹窗「分时」入口依赖）
// ---------------------------------------------------------------------------

test('resolveMinuteSources：A股个股未登记也按东财 → 腾讯双源兜底', () => {
  assert.deepEqual(resolveMinuteSources('sh600519'), { em: '1.600519', tc: 'sh600519' })
  assert.deepEqual(resolveMinuteSources('sz300911'), { em: '0.300911', tc: 'sz300911' })
  assert.deepEqual(resolveMinuteSources('bj920010'), { em: '0.920010', tc: 'bj920010' })
  assert.deepEqual(resolveMinuteSources('1.600519'), { em: '1.600519', tc: 'sh600519' })
  assert.deepEqual(resolveMinuteSources('0.300911'), { em: '0.300911', tc: 'sz300911' })
  // 裸 6 位代码不匹配（需 sh/sz/bj 前缀或 secid 形式）；已登记配置优先（如 sh000001 指数）
  assert.equal(resolveMinuteSources('600519'), null)
  assert.deepEqual(resolveMinuteSources('sh000001'), { em: '1.000001', tc: 'sh000001' })
  assert.equal(hasMinuteSources('sh600519'), true)
  assert.equal(hasMinuteSources('bj920010'), true)
  assert.equal(hasMinuteSources('600519'), false)
})

test('resolveMinuteSession：A股个股（含北交所 bj）识别为 A股时段', () => {
  assert.equal(resolveMinuteSession('sh600519'), 'ashare')
  assert.equal(resolveMinuteSession('sz000001'), 'ashare')
  assert.equal(resolveMinuteSession('bj920010'), 'ashare')
})
