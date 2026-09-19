/**
 * 均线图例排版纯函数（仅依赖 ctx 的 measureText）：两个 K 线图表组件共用。
 *
 * 五条均线（MA5/10/20/30/60）都带数值时文案很长（指数上万点：`MA60:52421.20`），
 * 窄屏 / 大数字下会互相叠压，因此按四级自适应降级：
 *   1. 10px 带完整数值 → 2. 9px 带完整数值 → 3. 9px 带缩写数值（≥1000 取整、≥100 留 1 位小数）
 *   → 4. 9px 只留周期名（MA5 MA10 MA20 MA30 MA60）。
 * 第 3 档存在的意义：指数（上证 / 纳指 / 道指）点位大，完整两位小数在手机宽度下塞不下，
 * 若直接跳到第 4 档，指数 K 线就只剩周期名、看不到均线数值了。
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

/** 数值展示档位：完整两位小数 / 缩写（大数取整或留 1 位小数）/ 不带数值 */
type LegendValueMode = 'full' | 'short' | 'none'

/** 四级降级候选（先大字号带完整数值，最后只留周期名） */
const LEGEND_ATTEMPTS: Array<{ font: string; mode: LegendValueMode }> = [
  { font: '10px sans-serif', mode: 'full' },
  { font: '9px sans-serif', mode: 'full' },
  { font: '9px sans-serif', mode: 'short' },
  { font: '9px sans-serif', mode: 'none' },
]

/**
 * 缩写均线数值（仅在「9px 带完整数值」都放不下时启用）：
 * ≥1000 取整（指数点位 3519.63 → 3520）、≥100 留 1 位小数、更小的价格保持两位小数。
 * 只影响图例这一处展示，不改动曲线与 `computeMA` 的计算精度。
 */
function shortenMaValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000) return value.toFixed(0)
  if (abs >= 100) return value.toFixed(1)
  return value.toFixed(2)
}

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
  const textsOf = (mode: LegendValueMode): string[] =>
    periods.map((period, index) => {
      if (mode === 'none') return `MA${period}`
      const value = valueOf(index)
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return `MA${period}:--`
      }
      return `MA${period}:${mode === 'short' ? shortenMaValue(value) : value.toFixed(2)}`
    })
  const widthOf = (font: string, texts: string[]): number => {
    ctx.font = font
    let width = 0
    for (const text of texts) width += ctx.measureText(text).width + LEGEND_GAP
    return Math.max(0, width - LEGEND_GAP)
  }

  let chosen = LEGEND_ATTEMPTS[LEGEND_ATTEMPTS.length - 1] as {
    font: string
    mode: LegendValueMode
  }
  let texts = textsOf(chosen.mode)
  for (const attempt of LEGEND_ATTEMPTS) {
    const candidate = textsOf(attempt.mode)
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
