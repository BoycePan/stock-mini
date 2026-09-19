import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * chart-controls 生命周期测试（分时页 K 线 TAB 的 ‹ › 长按连发控件）。
 *
 * 该组件用 setTimeout / setInterval 实现「长按连发平移」：按下后 400ms 起每 80ms 触发一次事件。
 * 连发期间若组件被销毁（切 TAB / 下拉刷新导致 chartReady 置 false 重建图表 / 退出页面），
 * 移动端不会再有 touchend / touchcancel 到达 → 定时器必须由组件自身在 detached 里清掉，
 * 否则每 80ms 对一个已销毁组件 triggerEvent，定时器与其闭包中的组件实例永不回收（内存泄漏）。
 *
 * 小程序运行时才有全局 Component，测试里先用桩捕获组件定义，再动态 import 组件模块。
 */
interface ComponentDef {
  methods: Record<string, (this: unknown, ...args: unknown[]) => unknown>
  lifetimes?: { detached?: (this: unknown) => void }
}

let captured: ComponentDef | null = null
Object.assign(globalThis, {
  Component: (definition: ComponentDef) => {
    captured = definition
  },
})

await import('../packageQuote/components/chart-controls/index.ts')

/** 极简组件实例替身：只提供长按连发路径用到的 emit / triggerEvent */
function fakeInstance() {
  const emitted: Array<{ event: string; step: number }> = []
  const self = {
    triggerEvent(event: string, detail: { step?: number }) {
      emitted.push({ event, step: detail.step ?? 0 })
    },
    emit(action: string, step: number) {
      this.triggerEvent(action, { step })
    },
  }
  return { self, emitted }
}

/** 构造「按下 ‹/›」的触摸事件（dataset.action 决定平移方向） */
function pressEvent(action = 'panright') {
  return { currentTarget: { dataset: { action } } }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('chart-controls：长按连发期间组件销毁必须停掉定时器（否则每 80ms 空转）', async () => {
  const component = captured as ComponentDef | null
  assert.ok(component, '应捕获到组件定义')
  const onPressStart = component.methods.onPressStart
  assert.ok(onPressStart, 'onPressStart 应存在')

  const { self, emitted } = fakeInstance()
  onPressStart.call(self, pressEvent())
  // 长按 400ms 后进入连发：至少触发过一次
  await wait(460)
  assert.ok(emitted.length >= 1, `长按应已进入连发（实际 ${emitted.length} 次）`)

  // 模拟切 TAB / 下拉刷新 / 退出页面：组件销毁
  component.lifetimes?.detached?.call(self)
  const afterDetach = emitted.length
  await wait(320)

  // 兜底清理：回归时残留的 setInterval 会让测试进程挂住不退，这里先停表再断言（失败信息更明确）
  component.methods.onPressCancel?.call(self)
  assert.equal(
    emitted.length,
    afterDetach,
    '组件销毁后不得继续触发连发事件（定时器未清理 = 内存泄漏）',
  )
})

test('chart-controls：连发前触摸被打断（滚动页面）不得再补发轻点，也不留定时器', async () => {
  const component = captured as ComponentDef | null
  assert.ok(component, '应捕获到组件定义')
  const onPressStart = component.methods.onPressStart
  const onPressCancel = component.methods.onPressCancel
  assert.ok(onPressStart, 'onPressStart 应存在')
  assert.ok(onPressCancel, 'onPressCancel 应存在')

  const { self, emitted } = fakeInstance()
  onPressStart.call(self, pressEvent())
  await wait(120)
  onPressCancel.call(self)
  await wait(420)

  assert.deepEqual(emitted, [], '取消后不得补发轻点 / 不得残留长按定时器')
})
