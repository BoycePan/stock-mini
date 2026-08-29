import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APP_ID,
  APP_NAME,
  LOGIN_SOURCE,
  resolveAppName,
  resolveLoginSource,
} from '../config/app.ts'

test('resolveAppName：已登记 AppID 返回对应小程序名称', () => {
  assert.equal(resolveAppName('wx2cfd1556edf21a24'), '市场追踪助手')
  assert.equal(resolveAppName('wx0ecd2049e54fbca8'), '行情追踪助手')
})

test('resolveAppName：未登记 AppID 回退默认名称', () => {
  assert.equal(resolveAppName('wxunknown0000000000'), '市场追踪助手')
  assert.equal(resolveAppName(''), '市场追踪助手')
})

test('resolveLoginSource：已登记 AppID 返回对应登录 source', () => {
  assert.equal(resolveLoginSource('wx2cfd1556edf21a24'), 'shiChang-tracker')
  assert.equal(resolveLoginSource('wx0ecd2049e54fbca8'), 'hangQing-tracker')
})

test('resolveLoginSource：未登记 AppID 回退默认 source', () => {
  assert.equal(resolveLoginSource('wxunknown0000000000'), 'shiChang-tracker')
  assert.equal(resolveLoginSource(''), 'shiChang-tracker')
})

test('APP_NAME / APP_ID：模块加载时按当前环境推导（wx 不可用时不抛错）', () => {
  assert.equal(typeof APP_NAME, 'string')
  assert.ok(APP_NAME.length > 0, 'APP_NAME 不应为空')
  assert.equal(typeof APP_ID, 'string')
  assert.equal(typeof LOGIN_SOURCE, 'string')
})
