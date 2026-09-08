import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveMinuteEnabled,
  resolveTop100Enabled,
  resolveUserShowEnvEnabled,
} from '../utils/system-config.ts'
import type { AppConfig } from '../types/system.ts'

const withConfig = (config: NonNullable<AppConfig['config']>): AppConfig => ({ config })

test('线上正式版：展示由 homeShowTop100 决定', () => {
  assert.equal(
    resolveTop100Enabled(
      withConfig({ homeShowTop100: true, homeShowTop100Dev: false }).config,
      true,
    ),
    true,
  )
  assert.equal(
    resolveTop100Enabled(
      withConfig({ homeShowTop100: false, homeShowTop100Dev: true }).config,
      true,
    ),
    false,
  )
})

test('开发版/体验版：展示由 homeShowTop100Dev 决定', () => {
  assert.equal(
    resolveTop100Enabled(
      withConfig({ homeShowTop100: false, homeShowTop100Dev: true }).config,
      false,
    ),
    true,
  )
  assert.equal(
    resolveTop100Enabled(
      withConfig({ homeShowTop100: true, homeShowTop100Dev: false }).config,
      false,
    ),
    false,
  )
})

test('配置未就绪（冷启动首屏竞态）：缺省不展示，不影响行情首屏加载', () => {
  assert.equal(resolveTop100Enabled(undefined, true), false)
  assert.equal(resolveTop100Enabled(undefined, false), false)
})

test('分时页开关：线上正式版由 canShowMinute 决定', () => {
  assert.equal(
    resolveMinuteEnabled(
      withConfig({
        homeShowTop100: true,
        homeShowTop100Dev: true,
        canShowMinute: true,
        canShowMinuteDev: false,
      }).config,
      true,
    ),
    true,
  )
  assert.equal(
    resolveMinuteEnabled(
      withConfig({
        homeShowTop100: true,
        homeShowTop100Dev: true,
        canShowMinute: false,
        canShowMinuteDev: true,
      }).config,
      true,
    ),
    false,
  )
})

test('分时页开关：开发版/体验版由 canShowMinuteDev 决定', () => {
  assert.equal(
    resolveMinuteEnabled(
      withConfig({
        homeShowTop100: true,
        homeShowTop100Dev: true,
        canShowMinute: false,
        canShowMinuteDev: true,
      }).config,
      false,
    ),
    true,
  )
  assert.equal(
    resolveMinuteEnabled(
      withConfig({
        homeShowTop100: true,
        homeShowTop100Dev: true,
        canShowMinute: true,
        canShowMinuteDev: false,
      }).config,
      false,
    ),
    false,
  )
})

test('分时页开关：配置未就绪缺省关闭（false = 不能跳转分时页）', () => {
  assert.equal(resolveMinuteEnabled(undefined, true), false)
  assert.equal(resolveMinuteEnabled(undefined, false), false)
})

test('开发者选项开关 userShowEnv：单一键、无 Dev 尾缀，由 userShowEnv 单独决定', () => {
  assert.equal(resolveUserShowEnvEnabled(withConfig({ userShowEnv: true }).config), true)
  assert.equal(resolveUserShowEnvEnabled(withConfig({ userShowEnv: false }).config), false)
})

test('开发者选项开关 userShowEnv：配置未就绪 / 键缺省一律关闭（入口缺省隐藏）', () => {
  assert.equal(resolveUserShowEnvEnabled(undefined), false)
  assert.equal(resolveUserShowEnvEnabled(withConfig({}).config), false)
})
