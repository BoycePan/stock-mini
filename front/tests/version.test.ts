import assert from 'node:assert/strict'
import test from 'node:test'

import { getAppVersion } from '../utils/version.ts'

interface WxLike {
  getAccountInfoSync: () => { miniProgram: { version: string; envVersion: string } }
}

function setWx(value: WxLike | undefined): void {
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
