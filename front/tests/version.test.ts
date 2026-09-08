import assert from 'node:assert/strict'
import test from 'node:test'

import { getAppVersion, getAppEnvVersion } from '../utils/version.ts'
import { clearAccountInfoCache, getAccountInfo } from '../utils/account-info.ts'

interface WxLike {
  getAccountInfoSync: () => { miniProgram: { version: string; envVersion: string } }
}

function setWx(value: WxLike | undefined): void {
  // getAccountInfo 是惰性缓存：换 wx mock 前必须清缓存，否则读到上一份账号信息
  clearAccountInfoCache()
  ;(globalThis as Record<string, unknown>).wx = value
}

test('getAppVersion：正式版返回微信运行时上报的发版版本号', () => {
  setWx({
    getAccountInfoSync: () => ({ miniProgram: { version: '1.0.2', envVersion: 'release' } }),
  })
  assert.equal(getAppVersion(), '1.0.2')
})

test('getAppVersion：体验版同样取上报版本号', () => {
  setWx({
    getAccountInfoSync: () => ({ miniProgram: { version: '1.1.0', envVersion: 'trial' } }),
  })
  assert.equal(getAppVersion(), '1.1.0')
})

test('getAppVersion：开发版版本号为空时回退兜底版本', () => {
  setWx({
    getAccountInfoSync: () => ({ miniProgram: { version: '', envVersion: 'develop' } }),
  })
  assert.match(getAppVersion(), /^\d+\.\d+\.\d+$/)
})

test('getAppVersion：wx 不可用时回退兜底版本', () => {
  setWx(undefined)
  assert.match(getAppVersion(), /^\d+\.\d+\.\d+$/)
})

test('getAppEnvVersion：返回微信上报的运行环境', () => {
  for (const env of ['develop', 'trial', 'release']) {
    setWx({ getAccountInfoSync: () => ({ miniProgram: { version: '1.0.0', envVersion: env } }) })
    assert.equal(getAppEnvVersion(), env)
  }
})

test('getAppEnvVersion：wx 不可用 / 字段缺失时返回空串', () => {
  setWx(undefined)
  assert.equal(getAppEnvVersion(), '')
  setWx({
    getAccountInfoSync: () => ({ miniProgram: { version: '1.0.0', envVersion: '' } }),
  })
  assert.equal(getAppEnvVersion(), '')
})

test('getAccountInfo：首次调用后缓存，不重复调用 wx.getAccountInfoSync', () => {
  let calls = 0
  setWx({
    getAccountInfoSync: () => {
      calls++
      return { miniProgram: { version: '1.0.0', envVersion: 'release' } }
    },
  })
  assert.equal(getAppVersion(), '1.0.0')
  assert.equal(getAppEnvVersion(), 'release')
  getAccountInfo()
  getAccountInfo()
  assert.equal(calls, 1, '多次读取只调用一次 wx')
})

test('getAccountInfo：clearAccountInfoCache 后重新读取 wx', () => {
  let version = '1.0.0'
  setWx({
    getAccountInfoSync: () => ({ miniProgram: { version, envVersion: 'release' } }),
  })
  assert.equal(getAppVersion(), '1.0.0')
  version = '2.0.0' // 模拟账号信息变化（测试专用）
  assert.equal(getAppVersion(), '1.0.0', '缓存命中，不重新读取')
  clearAccountInfoCache()
  assert.equal(getAppVersion(), '2.0.0', '清缓存后重新读取')
})
