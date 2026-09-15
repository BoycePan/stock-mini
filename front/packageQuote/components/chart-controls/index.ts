import { PAN_LONG_PRESS_MS, PAN_REPEAT_MS, panRepeatStep } from '../../../utils/kline-viewport'

/**
 * 图表缩放 / 平移控件条：`+ − ‹ ›` 四个按钮 + 左侧窗口文案。
 *
 * 由两个 K 线图表组件共用（quote-chart / kline-chart），保证两处手感与样式一致；
 * 组件自身不持有窗口状态，只把操作透传成事件，越界判断与夹紧都在父组件的窗口模型里
 * （见 utils/kline-viewport.ts）。
 *
 * 交互：
 * - **轻点 `‹` / `›`**：左右各移动 **1 根** K 线（事件 detail.step = 1）；
 * - **长按 `‹` / `›`**：约 400ms 后开始连发（每 80ms 一次），步长每 10 次加 1 根
 *   （1 → 2 → 3 …），长历史几秒即可翻到头；连发期间抬手不再补发轻点；
 * - `+` / `−`：轻点即缩放一步（无连发），事件 detail.step = 1。
 *
 * 事件：`zoomin` / `zoomout` / `panleft` / `panright`，detail = `{ step }`（禁用态不触发）。
 * 主题：`theme` 属性 + 根节点 `dark` 类（组件样式隔离，深色规则写在本组件 wxss）。
 */
Component({
  properties: {
    theme: { type: String, value: 'light' },
    /** 是否展示整条控件（非 K 线周期 / 数据太短时不展示） */
    show: { type: Boolean, value: false },
    /** 窗口文案，例：`30 / 500 根` */
    rangeText: { type: String, value: '' },
    zoomInDisabled: { type: Boolean, value: false },
    zoomOutDisabled: { type: Boolean, value: false },
    panLeftDisabled: { type: Boolean, value: false },
    panRightDisabled: { type: Boolean, value: false },
  },
  methods: {
    /** 按下：记录动作并起长按计时（只有平移支持连发） */
    onPressStart(event: WechatMiniprogram.TouchEvent) {
      const action = pressActionOf(event)
      if (!action) return
      const state: PressState = { action, repeating: false, tick: 0 }
      pressStates.set(this, state)
      if (action !== 'panleft' && action !== 'panright') return
      state.longPressTimer = setTimeout(() => {
        if (pressStates.get(this) !== state) return
        state.repeating = true
        this.emit(action, 1)
        state.repeatTimer = setInterval(() => {
          if (pressStates.get(this) !== state) return
          state.tick += 1
          this.emit(action, panRepeatStep(state.tick))
        }, PAN_REPEAT_MS)
      }, PAN_LONG_PRESS_MS)
    },
    /** 抬手：连发中则停手（不再补发轻点），否则按轻点补发一次（步长 1 根） */
    onPressEnd() {
      const state = pressStates.get(this)
      if (!state) return
      clearTimers(state)
      pressStates.delete(this)
      if (!state.repeating) this.emit(state.action, 1)
    },
    /**
     * 触摸被系统打断（页面滚动、来电等）：只清理定时器，**不补发轻点** ——
     * 用户本意是滚动页面，补发会让他莫名其妙地少看一根 K 线。
     */
    onPressCancel() {
      const state = pressStates.get(this)
      if (!state) return
      clearTimers(state)
      pressStates.delete(this)
    },
    emit(action: PressAction, step: number) {
      this.triggerEvent(action, { step })
    },
  },
})

type PressAction = 'zoomin' | 'zoomout' | 'panleft' | 'panright'

interface PressState {
  action: PressAction
  /** 是否已进入长按连发（连发过就不再补发轻点，避免多挪一根） */
  repeating: boolean
  /** 连发次数（用于逐步加速） */
  tick: number
  longPressTimer?: ReturnType<typeof setTimeout>
  repeatTimer?: ReturnType<typeof setInterval>
}

/** 组件实例 → 按压状态（不放进 data：这些字段不需要参与渲染） */
const pressStates = new WeakMap<object, PressState>()

/** 从事件的 dataset 取动作；禁用态返回 null（父组件的夹紧是兜底，这里避免无意义事件） */
function pressActionOf(event: WechatMiniprogram.TouchEvent): PressAction | null {
  const dataset = event.currentTarget.dataset as { action?: string; disabled?: boolean }
  if (!dataset.action || dataset.disabled) return null
  const action = dataset.action
  if (
    action === 'zoomin' ||
    action === 'zoomout' ||
    action === 'panleft' ||
    action === 'panright'
  ) {
    return action
  }
  return null
}

function clearTimers(state: PressState): void {
  if (state.longPressTimer) clearTimeout(state.longPressTimer)
  if (state.repeatTimer) clearInterval(state.repeatTimer)
  state.longPressTimer = undefined
  state.repeatTimer = undefined
}
