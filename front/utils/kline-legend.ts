/**
 * 均线图例排版纯函数（仅依赖 ctx 的 measureText）：两个 K 线图表组件共用。
 *
 * 四条均线（MA5/20/30/60）都带数值时文案很长（指数上万点：`MA60:52421.20`），
 * 窄屏 / 大数字下会互相叠压，因此按三级自适应降级：
 *   1. 10px 带数值 → 2. 9px 带数值 → 3. 9px 只留周期名（MA5 MA20 MA30 MA60）。
 * 颜色由调用方按 `colorIndex` 从自己的主题色板取（浅 / 深各一套），本模块不掺和配色。
 */

/** 结构化的 canvas 测量接口（小程序 canvas 2d 与浏览器 canvas 均满足） */
export interface LegendMeasureCtx {
  font: string
  measureText(text: string): { width: number }
}

export interface MaLegend {
  /** 采用的字体（调用方据此设置 ctx.font 后再 fillText） */
  font: string
  /** 图例项（text + 相对画布的 x 坐标 + 对应的均线下标） */
  items: Array<{ text: string; x: number; colorIndex: number }>
}

/** 图例项间距（px） */
const LEGEND_GAP = 8

/** 三级降级候选（先大字号带数值，最后只留周期名） */
const LEGEND_ATTEMPTS: Array<{ font: string; withValue: boolean }> = [
  { font: '10px sans-serif', withValue: true },
  { font: '9px sans-serif', withValue: true },
  { font: '9px sans-serif', withValue: false },
]

/**
 * 排布均线图例。
 * @param periods 均线周期（与 valueOf 的下标一一对应）
 * @param padL 绘图区左边界（图例起点）
 * @param plotW 绘图区宽度（可用宽度上限）
 * @param valueOf 取第 index 条均线的当前值（null / undefined / 非有限值渲染为 `--`）
 */
export function fitMaLegend(
  ctx: LegendMeasureCtx,
  options: {
    periods: readonly number[]
    padL: number
    plotW: number
    valueOf: (index: number) => number | null | undefined
  },
): MaLegend {
  const { periods, padL, plotW, valueOf } = options
  const textsOf = (withValue: boolean): string[] =>
    periods.map((period, index) => {
      if (!withValue) return `MA${period}`
      const value = valueOf(index)
      const text =
        value === null || value === undefined || !Number.isFinite(value) ? '--' : value.toFixed(2)
      return `MA${period}:${text}`
    })
  const widthOf = (font: string, texts: string[]): number => {
    ctx.font = font
    let width = 0
    for (const text of texts) width += ctx.measureText(text).width + LEGEND_GAP
    return Math.max(0, width - LEGEND_GAP)
  }

  let chosen = LEGEND_ATTEMPTS[LEGEND_ATTEMPTS.length - 1] as {
    font: string
    withValue: boolean
  }
  let texts = textsOf(chosen.withValue)
  for (const attempt of LEGEND_ATTEMPTS) {
    const candidate = textsOf(attempt.withValue)
    if (widthOf(attempt.font, candidate) <= plotW) {
      chosen = attempt
      texts = candidate
      break
    }
  }

  ctx.font = chosen.font
  const items: MaLegend['items'] = []
  let x = padL
  texts.forEach((text, index) => {
    items.push({ text, x, colorIndex: index })
    x += ctx.measureText(text).width + LEGEND_GAP
  })
  return { font: chosen.font, items }
}
