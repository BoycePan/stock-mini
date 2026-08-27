/**
 * Squarified Treemap 布局算法（纯 TS 实现，无外部依赖）。
 *
 * 参考 Bruls et al. 2000《Squarified Treemaps》：按权重（市值）将矩形区域递归切分，
 * 使每个块尽量接近正方形——这是 52etf.site / d3.treemap 同款布局效果。
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

/**
 * 计算一行的「最差纵横比」：行沿容器长边方向铺开（每块厚度 = 短边 s、沿长边长度为
 * (v_i/total)·长边 t），单项纵横比 = max(行方向长/厚度, 厚度/行方向长)。
 * 返回所有项中的最大纵横比——越接近 1 说明行内块越接近正方形。
 */
function worst(row: LayoutItem[], w: number, h: number): number {
  const total = row.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0 || w <= 0 || h <= 0) return Number.POSITIVE_INFINITY
  let max = -Infinity
  let min = Infinity
  for (const item of row) {
    if (item.weight > max) max = item.weight
    if (item.weight < min) min = item.weight
  }
  const t = Math.max(w, h) // 长边
  const s = Math.min(w, h) // 短边（厚度）
  // 单项纵横比 = max( (v_i·t)/(total·s), (total·s)/(v_i·t) )
  // 最差 = 对 v 取极值：第一项用 v_max，第二项用 v_min
  return Math.max((max * t) / (total * s), (total * s) / (min * t))
}

/**
 * Squarified treemap 主入口。
 * @param items 待布局节点（内部会按权重降序排列，调用方可传入任意顺序）
 * @param container 容器矩形（CSS 像素，调用方已去除内边距）
 * @returns 与 items 相同顺序（未排序前）对应的布局矩形数组；权重 ≤0 的节点被跳过
 */
export function squarifyTreemap(
  items: LayoutItem[],
  container: Rect,
  debug?: (msg: string) => void,
): LayoutRect[] {
  const dbg = debug ?? (() => {})
  if (!items.length || container.w <= 0 || container.h <= 0) return []

  // 过滤无效权重并降序
  const valid = items.filter((item) => item.weight > 0)
  const sorted = [...valid].sort((a, b) => b.weight - a.weight)
  if (!sorted.length) return []

  const results: LayoutRect[] = []
  let rect: Rect = { ...container }

  let index = 0
  while (index < sorted.length) {
    // 1) 贪心凑行：往行里加节点，直到加下一个会明显变差
    const row: LayoutItem[] = []
    let rowTotal = 0
    while (index < sorted.length) {
      const item = sorted[index] as LayoutItem
      row.push(item)
      rowTotal += item.weight
      if (row.length > 1) {
        const withItem = worst(row, rect.w, rect.h)
        const withoutItem = worst(row.slice(0, -1), rect.w, rect.h)
        if (withItem > withoutItem) {
          row.pop()
          rowTotal -= item.weight
          break
        }
      }
      index++
    }

    // 2) 行占当前矩形的「短边比例 = rowTotal/(rowTotal+剩余)」，沿长边铺开
    const remainingTotal = sorted.slice(index).reduce((sum, item) => sum + item.weight, 0)
    const total = rowTotal + remainingTotal
    const frac = total > 0 ? rowTotal / total : 1

    if (rect.w >= rect.h) {
      // 水平行：占满宽，高 = rect.h * frac
      const rowH = rect.h * frac
      let x = rect.x
      for (const item of row) {
        const w = (item.weight / rowTotal) * rect.w
        results.push({ id: item.id, x, y: rect.y, w, h: rowH })
        x += w
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH }
    } else {
      // 垂直行：占满高，宽 = rect.w * frac
      const rowW = rect.w * frac
      let y = rect.y
      for (const item of row) {
        const h = (item.weight / rowTotal) * rect.h
        results.push({ id: item.id, x: rect.x, y, w: rowW, h })
        y += h
      }
      rect = { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h }
    }
    dbg(
      `row[${row.length}] frac=${frac.toFixed(3)} rect=(${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.w.toFixed(1)},${rect.h.toFixed(1)})`,
    )
  }

  // 按输入顺序返回（保持与调用方 items 一致，方便按索引关联）
  const byId = new Map(results.map((r) => [r.id, r]))
  return valid.map((item) => {
    const r = byId.get(item.id)
    return r as LayoutRect
  })
}
