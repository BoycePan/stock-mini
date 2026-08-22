import assert from 'node:assert/strict'
import test from 'node:test'

import type { MarketMetric } from '../types/market.ts'
import { metricViewModel } from '../utils/market.ts'

const metric = (change: number, extra?: Partial<MarketMetric>): MarketMetric => ({
  id: 'm1',
  name: '测试指标',
  value: '1.23',
  change,
  ...extra,
})

test('metricViewModel：涨跌幅为 0% 时展示「0%」而非 —/--', () => {
  const vm = metricViewModel(metric(0))
  assert.equal(vm.changeText, '0%')
  assert.equal(vm.direction, '', '平盘不应显示箭头或破折号')
  assert.equal(vm.changeClass, 'flat')
})

test('metricViewModel：涨跌幅为正时展示 ▲ 与 + 号', () => {
  const vm = metricViewModel(metric(1.5))
  assert.equal(vm.changeText, '+1.5%')
  assert.equal(vm.direction, '▲')
  assert.equal(vm.changeClass, 'up')
})

test('metricViewModel：涨跌幅为负时展示 ▼ 与负号', () => {
  const vm = metricViewModel(metric(-2.35))
  assert.equal(vm.changeText, '-2.35%')
  assert.equal(vm.direction, '▼')
  assert.equal(vm.changeClass, 'down')
})

test('metricViewModel：hideChange 标记原样透传（由 WXML 决定是否隐藏徽标）', () => {
  const vm = metricViewModel(metric(0, { hideChange: true }))
  assert.equal(vm.hideChange, true)
})
