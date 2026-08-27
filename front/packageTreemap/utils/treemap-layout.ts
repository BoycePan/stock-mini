/**
 * Squarified Treemap 布局算法（纯 TS 实现，无外部依赖）。
 *
 * 参考 Bruls et al. 2000《Squarified Treemaps》：按权重（市值）将矩形区域递归切分，
 * 使每个块尽量接近正方形——这是 52etf.site / d3.treemap 同款布局效果。
 *
 * 实现要点（相对旧版的修正，避免「竖条」）：
 * 1. 行一律沿着容器的「短边」铺开（而不是旧版的长边）：短边决定行的长度，
 *    厚度 = 行面积 / 短边。竖屏下首行是横向条带（沿宽铺开），块才接近正方形。
 * 2. 权重先归一化为像素面积（总面积 = 容器面积），使 `worst` 纵横比判定与实际
 *    落位完全一致，避免因市值量级差异（1e8 ~ 2e12）导致零宽/零高竖条。
 * 3. 贪心凑行：每次加入下一个节点，若最差纵横比变差则回退，行内块尽量方。
 *
 * 输入：容器矩形 + 带权重节点；输出：每个节点的最终矩形坐标（像素）。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutItem {
  /** 节点唯一 id（须与 TreemapNode.id 对应） */
  id: string
  /** 面积权重（市值），必须 > 0 */
  weight: number
}

export interface LayoutRect extends Rect {
  id: string
}

/** 归一化后的内部节点（weight → 像素面积，单位与容器一致） */
interface PlacedItem {
  id: string
  area: number
}

/**
 * 单行（已归一化）的最差纵横比。
 * 行沿短边 `short` 铺开：长度 = short，厚度 = s/short（s = 行面积）。
 * 单项纵横比 = max( short²·v_i / s², s² / (short²·v_i) )，
 * 最差 = 用 v_max 取第一项、v_min 取第二项。
 * 越接近 1 说明行内块越接近正方形。
 */
function worst(row: PlacedItem[], short: number): number {
  let s = 0
  let max = -Infinity
  let min = Infinity
  for (const item of row) {
    s += item.area
    if (item.area > max) max = item.area
    if (item.area < min) min = item.area
  }
  if (s <= 0 || short <= 0 || !Number.isFinite(max) || !Number.isFinite(min)) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max((short * short * max) / (s * s), (s * s) / (short * short * min))
}

/**
 * Squarified treemap 主入口。
 * @param items 待布局节点（内部会按权重降序排列，调用方可传入任意顺序）
 * @param container 容器矩形（CSS 像素，调用方已去除内边距）
 * @param debug 可选调试回调
 * @returns 与 items 相同顺序（未排序前）对应的布局矩形数组；权重 ≤0 的节点被跳过
 */
export function squarifyTreemap(
  items: LayoutItem[],
  container: Rect,
  debug?: (msg: string) => void,
): LayoutRect[] {
  const dbg = debug ?? (() => {})
  if (!items.length || container.w <= 0 || container.h <= 0) return []

  // 过滤无效权重并归一化为像素面积（总面积 = 容器面积），再降序
  const valid = items.filter((item) => item.weight > 0)
  if (!valid.length) return []

  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0)
  const area = container.w * container.h
  const sorted: PlacedItem[] = valid
    .map((item) => ({ id: item.id, area: (item.weight / totalWeight) * area }))
    .sort((a, b) => b.area - a.area)

  const results: LayoutRect[] = []
  let rect: Rect = { ...container }

  let index = 0
  while (index < sorted.length) {
    // 1) 贪心凑行：往行里加节点，直到加下一个会明显变差
    const short = Math.min(rect.w, rect.h)
    const row: PlacedItem[] = []
    let rowArea = 0
    while (index < sorted.length) {
      const item = sorted[index] as PlacedItem
      row.push(item)
      rowArea += item.area
      if (row.length > 1) {
        const withItem = worst(row, short)
        const withoutItem = worst(row.slice(0, -1), short)
        if (withItem > withoutItem) {
          row.pop()
          rowArea -= item.area
          break
        }
      }
      index++
    }

    // 2) 行沿短边铺开：长度 = short，厚度 = 行面积 / short
    const thickness = rowArea / short
    if (rect.h >= rect.w) {
      // 高矩形：沿短边(宽 rect.w)铺一条横向条带（占满宽，厚度向下）
      let x = rect.x
      for (const item of row) {
        const w = (item.area / rowArea) * rect.w
        results.push({ id: item.id, x, y: rect.y, w, h: thickness })
        x += w
      }
      rect = { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness }
    } else {
      // 宽矩形：沿短边(高 rect.h)铺一条纵向条带（占满高，厚度向右）
      let y = rect.y
      for (const item of row) {
        const h = (item.area / rowArea) * rect.h
        results.push({ id: item.id, x: rect.x, y, w: thickness, h })
        y += h
      }
      rect = { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
    }
    dbg(
      `row[${row.length}] thickness=${thickness.toFixed(1)} short=${short.toFixed(1)} rect=(${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.w.toFixed(1)},${rect.h.toFixed(1)})`,
    )
  }

  // 按输入顺序返回（保持与调用方 items 一致，方便按索引关联）
  const byId = new Map(results.map((r) => [r.id, r]))
  return valid.map((item) => {
    const r = byId.get(item.id)
    return r as LayoutRect
  })
}
