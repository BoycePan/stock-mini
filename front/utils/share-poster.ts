/**
 * 行情分享海报（Canvas 2D 绘制）
 *
 * 首页（global）/ 日韩（asia）/ 有色（metals）三个行情页共用的海报渲染器；
 * 股票详情 / 板块详情等带 K 线图的页面通过 PosterChart 在海报中内嵌 K 线走势。
 * 参考 stock_other_mini 参考项目的 utils/share-card.js（金色头部卡片 + 分区数据行 + 水印）：
 * - 海报固定深色底（深浅主题下都清晰可读），设计坐标系宽 750；
 * - 头部渐变卡片：logo（front/static/images/logo.png）+ 标题 + 品牌副标题 + 时间戳 + 状态胶囊；
 * - 分区数据按双列网格绘制（名称 + 数值 + 涨跌幅，涨跌着色）；
 * - 水印「微信小程序搜「{品牌名}」查看实时行情」，品牌名按当前 AppID 动态取
 *   config/app.ts 的 APP_NAME（多小程序部署下各端展示各自名称）。
 *
 * 调用方（market-page 组件）持有隐藏画布 <canvas type="2d" id="shareCanvas">，
 * 通过 renderSharePoster 导出临时文件，返回 Promise<tempFilePath>。
 */

import type { MarketSection } from '../types/market'
import { formatChange } from './formatter'
import { APP_NAME } from '../config/app'

// 品牌名（水印 / 头部副标题）按当前 AppID 动态解析，re-export 保持既有调用方 import 不变
export { APP_NAME }

/** 海报设计宽度（px），隐藏画布 CSS 宽度固定 750 */
export const POSTER_WIDTH = 750

/** 品牌 logo（海报头部圆角裁切绘制） */
export const LOGO_PATH = '/static/images/logo.png'

/** 海报调色：固定深色（参考项目同款），涨跌色沿用全局色板 */
const CARD_BG = '#1b2334'
const TEXT_MAIN = '#f4efe6'
const TEXT_DIM = '#8b93a7'
const GOLD = '#c9a86c'
/** 新闻导语高亮（对齐详情页 .detail-summary-lead 的深色强调蓝） */
const LEAD_COLOR = '#6fa3ff'
const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'
const FLAT_COLOR = '#8b93a7'

// 布局参数（设计坐标系）：顶部留白 + 宽松间距，避免拥挤
const M = 28 // 外白边（减小以留更多内容宽度）
const HEADER_TOP = 52 // 顶部留白 + 头部卡片上边距
const HEADER_H = 178 // 头部卡片高度（更舒展）
const HEADER_R = 28 // 头部卡片圆角
const HEADER_BOTTOM_GAP = 28 // 头部卡片与首个分区的间距
const GRID_GAP = 14 // 双列间距（收窄，给内容更多宽度）
const CELL_H = 120 // 数据单元格高度
const CELL_H_COMPACT = 90 // 仅涨跌幅分区（行业板块）的紧凑单元格高度
const CELL_GAP = 14 // 数据行间距
const TITLE_H = 60 // 分区标题行高
const SECTION_GAP = 26 // 分区间距
const FOOTER_H = 104 // 水印区 + 底部留白

export type PosterTone = 'up' | 'down' | 'flat'

export interface PosterRow {
  name: string
  value: string
  changeText: string
  tone: PosterTone
  /** 名称前的展示图标（Emoji，如 🇨🇳 🥇 💱）；有 iconImage 时忽略 */
  icon?: string
  /** 名称前的展示图标图片（本地静态图，如 /static/icons/...），优先于 icon 绘制 */
  iconImage?: string
}

export interface PosterSection {
  title: string
  /** 行网格数据；text 段落分区可省略 */
  rows?: PosterRow[]
  /** 仅涨跌幅分区（如行业板块）：使用紧凑单元格，内容居中单行展示 */
  compact?: boolean
  /**
   * 全文段落（新闻摘要等）：设置后忽略 rows，渲染为整行宽卡片的多行文本，
   * 高度按实际换行行数计算（测量需传入 ctx，无 ctx 时按 CJK 宽度估算兜底）。
   */
  text?: string
  /**
   * 段落导语（新闻摘要开头的【…】等）：仅 text 分区生效，首行前缀用强调色加粗绘制，
   * 对齐详情页 .detail-summary-lead 的导语高亮。
   */
  lead?: string
}

export interface PosterData {
  /** 海报主标题（如「全球市场行情」「财联社」） */
  title: string
  /** 副标题（品牌名） */
  subtitle: string
  /** 状态文案（如「全球市场」「有色」），画在头部状态胶囊；为空时不绘制胶囊 */
  statusText: string
  /** 时间戳（如 2026-08-21 21:45） */
  stamp: string
  /** 是否绘制水印 */
  includeWatermark: boolean
  sections: PosterSection[]
  /**
   * 正文大标题（新闻标题等）：绘制在头部卡片与分区之间，多行换行不省略号，
   * 适用于头部主标题位置被短文案占用（如来源名）的场景。
   */
  heroText?: string
}

/**
 * 海报内嵌图表（如 K 线走势）：绘制在头部卡片与数据分区之间。
 * 由调用方（kline-poster 等）提供面板标题、总高度与绘制回调，
 * draw 收到的矩形为面板内部内容区（已扣除标题行与底部内边距）。
 */
export interface PosterChart {
  /** 图表面板标题（如「K线走势」） */
  title: string
  /** 图表面板总高度（设计坐标系） */
  height: number
  /** 绘制图表内容（面板内容矩形：x/y/w/h） */
  draw: (ctx: CanvasCtx, x: number, y: number, w: number, h: number) => void
}

type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

/** 时间戳：yyyy-MM-dd HH:mm */
export function formatShareStamp(date?: Date): string {
  const d = date || new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  )
}

/** 水印文案 */
export function watermarkText(): string {
  return `微信小程序搜「${APP_NAME}」查看实时行情`
}

/**
 * 去除 emoji 的变体选择符（U+FE0E 文字 / U+FE0F 表情）。
 * iOS Canvas 会把 U+FE0F 渲染成多余的小方块（如 ⚙️ ☁️ ☀️ 🛢️ 🗄️ 🛡️ ☢️ 🛰️ 等），
 * 去掉后基础字形以线条样式正常显示，不再出现乱码方块。
 */
function sanitizeIcon(icon: string | undefined): string | undefined {
  if (!icon) return icon
  return icon.replace(/[\uFE0E\uFE0F]/g, '')
}

/**
 * 把页面展示模型（MarketSection[]）归一化为海报分区数据：
 * - 无价格且无涨跌幅的指标跳过；
 * - hideChange（金店金价等无意义涨跌幅）不绘制涨跌幅；
 * - 涨跌幅 0 正常展示「0%」（与页面一致，不再显示「—」）。
 */
export function buildPosterSections(sections: MarketSection[]): PosterSection[] {
  const result: PosterSection[] = []
  for (const section of sections ?? []) {
    const rows: PosterRow[] = []
    for (const metric of section.metrics ?? []) {
      const change = Number(metric.change) || 0
      const changeText = metric.hideChange ? '' : formatChange(change)
      const value = String(metric.value ?? '')
      if (value === '' && changeText === '') continue
      rows.push({
        name: metric.name || '',
        value,
        changeText,
        tone: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        icon: sanitizeIcon(metric.icon),
        iconImage: metric.iconImage,
      })
    }
    if (rows.length) {
      result.push({
        title: section.title || '',
        rows,
        // 全部条目均无价格（仅涨跌幅，如行业板块）→ 紧凑单行居中展示
        compact: rows.every((row) => row.value === ''),
      })
    }
  }
  return result
}

/** 分区单元格高度：仅涨跌幅分区用紧凑高度，避免大单元格空置 */
function sectionCellHeight(section: PosterSection): number {
  return section.compact ? CELL_H_COMPACT : CELL_H
}

// 全文段落分区（新闻摘要等）排版参数（设计坐标系）
const TEXT_FONT_SIZE = 28 // 段落字号
const TEXT_LINE_HEIGHT = 40 // 行高
const TEXT_PAD = 24 // 段落卡片内边距
/** 段落最多绘制行数：超出截断并加省略号，防止超长摘要撑爆海报 */
const MAX_TEXT_LINES = 14

// 正文大标题（heroText，新闻标题等）排版参数
const HERO_FONT_SIZE = 38 // 标题字号（加粗）
const HERO_LINE_HEIGHT = 56 // 行高
const HERO_MAX_LINES = 6 // 最多行数，超出截断
const HERO_BOTTOM_GAP = 24 // 与下方分区的间距
// 正文大标题左侧蓝色强调条（对齐详情页 .detail-title-bar）
const HERO_BAR_W = 6
const HERO_BAR_GAP = 18

/** 按字符贪心换行（CJK / 拉丁混排均可），返回宽度不超过 maxWidth 的行 */
function wrapTextLines(ctx: CanvasCtx, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of String(text)) {
    const next = line + ch
    if (line !== '' && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * 全文段落分区面板高度（含上下内边距，不含分区标题行）。
 * 有 ctx 时按真实换行行数精确测量；无 ctx 时按 CJK 每字 ≈ 字号宽度估算兜底，
 * 保证 measurePosterHeight 在无画布环境下（如单测）也能返回合理值。
 */
function textSectionPanelHeight(ctx: CanvasCtx | undefined, section: PosterSection): number {
  const text = section.text || ''
  let lineCount: number
  const maxWidth = POSTER_WIDTH - M * 2 - TEXT_PAD * 2
  if (ctx) {
    ctx.font = `${TEXT_FONT_SIZE}px sans-serif`
    lineCount = wrapTextLines(ctx, text, maxWidth).length
  } else {
    const charsPerLine = Math.max(1, Math.floor(maxWidth / TEXT_FONT_SIZE))
    lineCount = Math.max(1, Math.ceil(text.length / charsPerLine))
  }
  return TEXT_PAD * 2 + Math.min(lineCount, MAX_TEXT_LINES) * TEXT_LINE_HEIGHT
}

/** 正文大标题（heroText）高度：含与下方分区的间距 */
function heroTextHeight(ctx: CanvasCtx | undefined, text: string): number {
  let lineCount: number
  // 预留左侧强调条宽度，保证测量行数与绘制一致
  const maxWidth = POSTER_WIDTH - M * 2 - HERO_BAR_W - HERO_BAR_GAP
  if (ctx) {
    ctx.font = `bold ${HERO_FONT_SIZE}px sans-serif`
    lineCount = wrapTextLines(ctx, text, maxWidth).length
  } else {
    const charsPerLine = Math.max(1, Math.floor(maxWidth / HERO_FONT_SIZE))
    lineCount = Math.max(1, Math.ceil(text.length / charsPerLine))
  }
  return Math.min(lineCount, HERO_MAX_LINES) * HERO_LINE_HEIGHT + HERO_BOTTOM_GAP
}

/** 按分区数据计算海报总高度（设计坐标系）；chart 非空时计入内嵌图表面板高度 */
export function measurePosterHeight(
  data: PosterData,
  chart?: PosterChart,
  ctx?: CanvasCtx,
): number {
  let h = HEADER_TOP + HEADER_H + HEADER_BOTTOM_GAP
  if (data.heroText) h += heroTextHeight(ctx, data.heroText)
  if (chart) h += chart.height + SECTION_GAP
  for (const section of data.sections) {
    if (section.text) {
      h += TITLE_H + textSectionPanelHeight(ctx, section) + SECTION_GAP
      continue
    }
    h += TITLE_H
    const cellH = sectionCellHeight(section)
    const rowCount = Math.max(1, Math.ceil((section.rows ?? []).length / 2))
    h += rowCount * cellH + (rowCount - 1) * CELL_GAP
    h += SECTION_GAP
  }
  return h + FOOTER_H
}

function roundRect(ctx: CanvasCtx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function truncText(ctx: CanvasCtx, text: string, maxWidth: number): string {
  const str = String(text == null ? '' : text)
  if (str === '' || maxWidth <= 0) return str
  if (ctx.measureText(str).width <= maxWidth) return str
  const ellipsis = '…'
  let i = str.length
  while (i > 0) {
    i -= 1
    const t = str.slice(0, i) + ellipsis
    if (ctx.measureText(t).width <= maxWidth) return t
  }
  return ellipsis
}

function toneColor(tone: PosterTone): string {
  if (tone === 'up') return UP_COLOR
  if (tone === 'down') return DOWN_COLOR
  return FLAT_COLOR
}

// 国旗 emoji 在 Canvas 2D 上可能渲染成乱码（iOS 会显示成 CN 等字母 / 部分安卓为空白框），
// 海报中统一转成「圆角文字徽标」，保证各机型稳定显示
const FLAG_CHIP: Record<string, string> = {
  '🇨🇳': '中',
  '🇺🇸': '美',
  '🇰🇷': '韩',
  '🇯🇵': '日',
  '🇻🇳': '越',
  '🇮🇳': '印',
}
const CHIP_SIZE = 32 // 徽标边长
const CHIP_RADIUS = 9 // 徽标圆角
const CHIP_GAP = 10 // 徽标与名称间距

/**
 * 绘制名称前的图标：优先绘制图片（iconImage），其次国旗转「金色文字徽标」，
 * 普通 emoji 直接绘制。
 * @param useMiddle 为 true 时，将 baseY 视为垂直中心坐标（适配 middle 基线模式）
 */
function drawRowIcon(
  ctx: CanvasCtx,
  chipText: string | undefined,
  icon: string | undefined,
  iconImg: WechatMiniprogram.Image | undefined,
  x: number,
  baseY: number,
  useMiddle = false,
): void {
  if (iconImg) {
    const iconY = useMiddle ? baseY - CHIP_SIZE / 2 : baseY - CHIP_SIZE + 4
    ctx.drawImage(iconImg, x, iconY, CHIP_SIZE, CHIP_SIZE)
  } else if (chipText) {
    const chipY = useMiddle ? baseY - CHIP_SIZE / 2 : baseY - CHIP_SIZE + 4
    // 金色标签：淡金底 + 细描边 + 金色单字（与头部/水印同色系，明确是市场标识）
    roundRect(ctx, x, chipY, CHIP_SIZE, CHIP_SIZE, CHIP_RADIUS)
    ctx.fillStyle = 'rgba(201,168,108,0.16)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(201,168,108,0.45)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = 'bold 24px sans-serif'
    ctx.textAlign = 'center'
    // 徽标文字内部居中，不受外部 textBaseline 影响
    const savedBaseline = ctx.textBaseline
    ctx.textBaseline = 'middle'
    ctx.fillText(chipText, x + CHIP_SIZE / 2, chipY + CHIP_SIZE / 2)
    ctx.textBaseline = savedBaseline
  } else if (icon) {
    ctx.fillStyle = TEXT_MAIN
    ctx.font = '28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(icon, x, baseY)
  }
}

/** 图标占位宽度（绘制前用于名称截断测量） */
function rowIconWidth(
  ctx: CanvasCtx,
  chipText: string | undefined,
  icon: string | undefined,
  iconImg: WechatMiniprogram.Image | undefined,
): number {
  if (iconImg) return CHIP_SIZE + CHIP_GAP
  if (chipText) return CHIP_SIZE + CHIP_GAP
  if (icon) return ctx.measureText(icon).width + CHIP_GAP
  return 0
}

/** 绘制头部渐变卡片：logo + 标题 + 品牌名 + 时间戳 + 状态胶囊 */
function drawHeader(
  ctx: CanvasCtx,
  data: PosterData,
  width: number,
  logoImg: WechatMiniprogram.Image | null,
): void {
  // 头部卡片：对角线渐变 + 发光描边
  roundRect(ctx, M, HEADER_TOP, width - M * 2, HEADER_H, HEADER_R)
  const grad = ctx.createLinearGradient(M, HEADER_TOP, width - M, HEADER_TOP + HEADER_H)
  grad.addColorStop(0, '#1e2d4a')
  grad.addColorStop(0.5, '#192540')
  grad.addColorStop(1, '#141e35')
  ctx.fillStyle = grad
  ctx.fill()
  // 外发光描边：金色 + 半透明蓝紫双层
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(201,168,108,0.45)'
  ctx.stroke()
  // 内高光线（顶部边缘）
  ctx.save()
  roundRect(ctx, M, HEADER_TOP, width - M * 2, HEADER_H, HEADER_R)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(M + HEADER_R, HEADER_TOP + 1)
  ctx.lineTo(width - M - HEADER_R, HEADER_TOP + 1)
  ctx.stroke()
  // 右侧边缘蓝紫光晕
  const sideGlow = ctx.createLinearGradient(width - M - 120, HEADER_TOP, width - M, HEADER_TOP)
  sideGlow.addColorStop(0, 'rgba(100,120,255,0)')
  sideGlow.addColorStop(1, 'rgba(100,120,255,0.12)')
  ctx.fillStyle = sideGlow
  ctx.fillRect(width - M - 120, HEADER_TOP, 120, HEADER_H)
  ctx.restore()

  const rightX = width - M - 24 // 右侧内容对齐线
  const titleX = M + 24 + 88 + 26 // logo 右侧 + 间距

  // 状态胶囊（右上，宽度随文案自适应）——先算几何，供标题截断宽度使用；
  // statusText 为空（如新闻海报头部主标题即来源名）时不绘制胶囊，标题宽度延伸到右缘
  const status = data.statusText || ''
  ctx.font = '22px sans-serif'
  const statusW = ctx.measureText(status).width
  const pillW = Math.max(70, statusW + 38)
  const pillH = 40
  const pillX = rightX - pillW
  const pillY = HEADER_TOP + 74
  const hasPill = status !== ''

  // Logo（圆角裁切）
  const logoX = M + 24
  const logoY = HEADER_TOP + 44
  const logoSize = 88
  roundRect(ctx, logoX, logoY, logoSize, logoSize, 24)
  ctx.fillStyle = '#1a2436'
  ctx.fill()
  if (logoImg) {
    ctx.save()
    roundRect(ctx, logoX, logoY, logoSize, logoSize, 24)
    ctx.clip()
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize)
    ctx.restore()
  } else {
    // logo 加载失败时占位：品牌名首字（多小程序部署下按当前名称动态取首字）
    ctx.fillStyle = GOLD
    ctx.font = 'bold 50px sans-serif'
    ctx.textAlign = 'center'
    const brandChar = Array.from(data.subtitle || APP_NAME)[0] || '市'
    ctx.fillText(brandChar, logoX + logoSize / 2, logoY + logoSize / 2 + 18)
  }

  // 标题（左，最大宽度到状态胶囊左侧；无胶囊时延伸到右缘）
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_MAIN
  ctx.font = 'bold 42px sans-serif'
  const titleMaxW = hasPill
    ? Math.max(100, pillX - titleX - 16)
    : Math.max(100, rightX - titleX - 8)
  ctx.fillText(truncText(ctx, data.title || '', titleMaxW), titleX, HEADER_TOP + 86)

  // 品牌名（小程序名称，金色突出显示）
  ctx.fillStyle = GOLD
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText(data.subtitle || '', titleX, HEADER_TOP + 134)

  // 时间戳（右上）
  ctx.textAlign = 'right'
  ctx.fillStyle = GOLD
  ctx.font = '22px sans-serif'
  ctx.fillText(data.stamp || '', rightX, HEADER_TOP + 56)

  // 状态胶囊
  if (hasPill) {
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fillStyle = 'rgba(201,168,108,0.16)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(201,168,108,0.45)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.textAlign = 'center'
    ctx.fillText(status, pillX + pillW / 2, pillY + 27)
    ctx.textAlign = 'left'
  }
}

/** 绘制单个数据单元格：
 * - 行情卡（有数值）：第一行图标/徽标 + 名称，第二行数值（加粗）+ 涨跌幅（着色，带涨跌符号）
 * - 行业板块等仅涨跌幅条目：图标/徽标 + 名称靠左，涨跌幅靠右，同一行垂直居中
 */
function drawCell(
  ctx: CanvasCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  row: PosterRow,
  iconImgs: Record<string, WechatMiniprogram.Image>,
): void {
  roundRect(ctx, x, y, w, h, 20)
  ctx.fillStyle = CARD_BG
  ctx.fill()
  // 卡片微光描边，增加层次感
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.stroke()

  const hasValue = row.value !== ''
  const hasChange = row.changeText !== ''
  const tone = toneColor(row.tone)
  const padL = 18
  const padR = 18
  const innerW = w - padL - padR
  // 图标图片（品牌/公司 logo、金条银条、Twemoji PNG）优先；其次国旗 emoji 转文字徽标
  const iconImg = row.iconImage ? iconImgs[row.iconImage] : undefined
  const chipText = row.icon && !iconImg ? FLAG_CHIP[row.icon] : undefined
  // 涨跌符号（▲/▼，flat 不加符号）
  const arrow = row.tone === 'up' ? '▲' : row.tone === 'down' ? '▼' : ''
  const changeLabel = arrow ? `${arrow} ${row.changeText}` : row.changeText

  ctx.textBaseline = 'alphabetic'

  if (hasValue && hasChange) {
    // 第一行：图标 / 徽标 + 名称
    ctx.fillStyle = TEXT_DIM
    ctx.font = '30px sans-serif'
    ctx.textAlign = 'left'
    const iconW = rowIconWidth(ctx, chipText, row.icon, iconImg)
    ctx.fillText(truncText(ctx, row.name, innerW - iconW), x + padL + iconW, y + 48)
    drawRowIcon(ctx, chipText, row.icon, iconImg, x + padL, y + 48)
    // 第二行：数值（左，加粗大字）+ 涨跌幅（右，着色）
    ctx.fillStyle = TEXT_MAIN
    ctx.font = 'bold 38px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(truncText(ctx, row.value, innerW - 130), x + padL, y + 100)
    ctx.fillStyle = tone
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(changeLabel, x + w - padR, y + 100)
  } else if (hasValue) {
    // 仅数值（如金店金价等无涨跌幅）：名称（第一行）+ 数值（第二行）
    ctx.fillStyle = TEXT_DIM
    ctx.font = '30px sans-serif'
    ctx.textAlign = 'left'
    const iconW = rowIconWidth(ctx, chipText, row.icon, iconImg)
    ctx.fillText(truncText(ctx, row.name, innerW - iconW), x + padL + iconW, y + 48)
    drawRowIcon(ctx, chipText, row.icon, iconImg, x + padL, y + 48)
    ctx.fillStyle = TEXT_MAIN
    ctx.font = 'bold 38px sans-serif'
    ctx.fillText(truncText(ctx, row.value, innerW), x + padL, y + 100)
  } else if (hasChange) {
    // 行业板块：名称靠左，涨跌幅靠右，同一行垂直居中
    ctx.font = 'bold 30px sans-serif'
    const changeW = ctx.measureText(changeLabel).width
    ctx.font = '30px sans-serif'
    const iconW = rowIconWidth(ctx, chipText, row.icon, iconImg)
    // 使用 middle 基线实现真正的垂直居中
    ctx.textBaseline = 'middle'
    const midY = y + h / 2
    drawRowIcon(ctx, chipText, row.icon, iconImg, x + padL, midY, true)
    ctx.fillStyle = TEXT_MAIN
    ctx.font = '30px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(truncText(ctx, row.name, innerW - iconW - changeW - 16), x + padL + iconW, midY)
    ctx.fillStyle = tone
    ctx.font = 'bold 30px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(changeLabel, x + w - padR, midY)
    ctx.textBaseline = 'alphabetic'
  }
}

/** 绘制整张海报（画布尺寸需先按 measurePosterHeight 设置） */
export function drawPoster(
  ctx: CanvasCtx,
  data: PosterData,
  width: number,
  logoImg: WechatMiniprogram.Image | null = null,
  chart?: PosterChart,
  iconImgs: Record<string, WechatMiniprogram.Image> = {},
): void {
  const height = measurePosterHeight(data, chart, ctx)

  // ── 背景：极光渐变（深蓝 → 靛蓝 → 深紫）斜向过渡 ──────────────
  const bg = ctx.createLinearGradient(0, 0, width * 0.6, height)
  bg.addColorStop(0, '#0d1526')
  bg.addColorStop(0.38, '#111d35')
  bg.addColorStop(0.72, '#13183a')
  bg.addColorStop(1, '#0c1020')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // 极光光晕 1：左上角蓝紫光斑
  const glow1 = ctx.createRadialGradient(
    width * 0.18,
    height * 0.12,
    0,
    width * 0.18,
    height * 0.12,
    width * 0.55,
  )
  glow1.addColorStop(0, 'rgba(79,112,220,0.22)')
  glow1.addColorStop(0.5, 'rgba(99,72,200,0.10)')
  glow1.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow1
  ctx.fillRect(0, 0, width, height)

  // 极光光晕 2：右下角青绿光斑
  const glow2 = ctx.createRadialGradient(
    width * 0.85,
    height * 0.78,
    0,
    width * 0.85,
    height * 0.78,
    width * 0.5,
  )
  glow2.addColorStop(0, 'rgba(20,180,160,0.14)')
  glow2.addColorStop(0.5, 'rgba(30,120,160,0.07)')
  glow2.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, width, height)

  // 微网格纹理：横向细线增加质感
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'
  ctx.lineWidth = 1
  for (let lineY = 0; lineY < height; lineY += 60) {
    ctx.beginPath()
    ctx.moveTo(0, lineY)
    ctx.lineTo(width, lineY)
    ctx.stroke()
  }

  drawHeader(ctx, data, width, logoImg)

  // 分区数据（双列网格）
  const cellW = (width - M * 2 - GRID_GAP) / 2
  let y = HEADER_TOP + HEADER_H + HEADER_BOTTOM_GAP

  // 正文大标题（新闻标题等）：整行宽、多行换行、超长才截断，绘制在头部与分区之间
  if (data.heroText) {
    const heroMaxW = width - M * 2 - HERO_BAR_W - HERO_BAR_GAP
    const heroX = M + HERO_BAR_W + HERO_BAR_GAP
    ctx.font = `bold ${HERO_FONT_SIZE}px sans-serif`
    ctx.textAlign = 'left'
    ctx.fillStyle = TEXT_MAIN
    const heroLines = wrapTextLines(ctx, data.heroText, heroMaxW)
    const heroTruncated = heroLines.length > HERO_MAX_LINES
    const heroShown = heroLines.slice(0, HERO_MAX_LINES)
    // 左侧蓝色渐变强调条（对齐详情页 .detail-title-bar）
    const barTop = y + 6
    const barBottom = y + heroShown.length * HERO_LINE_HEIGHT - 6
    const barGrad = ctx.createLinearGradient(0, barTop, 0, barBottom)
    barGrad.addColorStop(0, '#6fa3ff')
    barGrad.addColorStop(1, '#4278ed')
    roundRect(ctx, M, barTop, HERO_BAR_W, Math.max(0, barBottom - barTop), 3)
    ctx.fillStyle = barGrad
    ctx.fill()
    heroShown.forEach((line, i) => {
      const isLast = i === heroShown.length - 1
      const label = isLast && heroTruncated ? truncText(ctx, line + '…', heroMaxW) : line
      ctx.fillText(label, heroX, y + HERO_FONT_SIZE)
      y += HERO_LINE_HEIGHT
    })
    // 装饰分割线：渐变线 + 蓝色菱形（对齐详情页 .detail-divider）
    const lineY = y + HERO_BOTTOM_GAP / 2
    const midX = width / 2
    const lineLen = (width - M * 2) / 2 - 26
    const gradL = ctx.createLinearGradient(M, lineY, M + lineLen, lineY)
    gradL.addColorStop(0, 'rgba(111,163,255,0)')
    gradL.addColorStop(1, 'rgba(111,163,255,0.45)')
    ctx.strokeStyle = gradL
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(M, lineY)
    ctx.lineTo(M + lineLen, lineY)
    ctx.stroke()
    const gradR = ctx.createLinearGradient(width - M, lineY, width - M - lineLen, lineY)
    gradR.addColorStop(0, 'rgba(111,163,255,0)')
    gradR.addColorStop(1, 'rgba(111,163,255,0.45)')
    ctx.strokeStyle = gradR
    ctx.beginPath()
    ctx.moveTo(width - M, lineY)
    ctx.lineTo(width - M - lineLen, lineY)
    ctx.stroke()
    const dia = 12
    ctx.save()
    ctx.translate(midX, lineY)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = LEAD_COLOR
    roundRect(ctx, -dia / 2, -dia / 2, dia, dia, 3)
    ctx.fill()
    ctx.restore()
    y += HERO_BOTTOM_GAP
  }

  // 内嵌图表（K 线走势等）：圆角卡片 + 金色标题 + 绘制回调（画在头部与分区之间）
  if (chart) {
    const panelX = M
    const panelW = width - M * 2
    roundRect(ctx, panelX, y, panelW, chart.height, 24)
    ctx.fillStyle = CARD_BG
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.stroke()
    // 面板标题：金色小竖条 + 文案
    roundRect(ctx, panelX + 24, y + 20, 6, 26, 3)
    ctx.fillStyle = 'rgba(201,168,108,0.9)'
    ctx.fill()
    ctx.fillStyle = TEXT_DIM
    ctx.font = '26px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(chart.title || '', panelX + 44, y + 41)
    // 图表内容（标题行以下，四周留内边距）
    chart.draw(ctx, panelX + 24, y + 70, panelW - 48, chart.height - 90)
    y += chart.height + SECTION_GAP
  }
  for (const section of data.sections) {
    // 分区标题：金色小竖条 + 文案
    roundRect(ctx, M, y + 14, 6, 30, 3)
    ctx.fillStyle = 'rgba(201,168,108,0.9)'
    ctx.fill()
    ctx.fillStyle = TEXT_DIM
    ctx.font = '28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(section.title || '', M + 22, y + 39)
    y += TITLE_H

    // 全文段落分区（新闻摘要等）：整行宽卡片 + 多行文本，替代行网格
    if (section.text) {
      const panelX = M
      const panelW = width - M * 2
      const textMaxW = panelW - TEXT_PAD * 2
      const lines = wrapTextLines(ctx, section.text, textMaxW)
      const truncated = lines.length > MAX_TEXT_LINES
      const shown = lines.slice(0, MAX_TEXT_LINES)
      const panelH = TEXT_PAD * 2 + shown.length * TEXT_LINE_HEIGHT
      roundRect(ctx, panelX, y, panelW, panelH, 20)
      ctx.fillStyle = CARD_BG
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.textAlign = 'left'
      const textX = panelX + TEXT_PAD
      // 导语（【…】）从首行起用强调色加粗绘制，剩余部分回主色（对齐详情页 .detail-summary-lead）
      let leadRemain = (section.lead || '').length
      shown.forEach((line, i) => {
        const isLast = i === shown.length - 1
        const label = isLast && truncated ? truncText(ctx, line + '…', textMaxW) : line
        const baseY = y + TEXT_PAD + TEXT_LINE_HEIGHT * i + TEXT_FONT_SIZE
        if (leadRemain > 0) {
          const leadPart = label.slice(0, Math.min(leadRemain, label.length))
          leadRemain = Math.max(0, leadRemain - leadPart.length)
          ctx.font = `bold ${TEXT_FONT_SIZE}px sans-serif`
          ctx.fillStyle = LEAD_COLOR
          ctx.fillText(leadPart, textX, baseY)
          const restPart = label.slice(leadPart.length)
          if (restPart) {
            const leadW = ctx.measureText(leadPart).width
            ctx.font = `${TEXT_FONT_SIZE}px sans-serif`
            ctx.fillStyle = TEXT_MAIN
            ctx.fillText(restPart, textX + leadW, baseY)
          }
        } else {
          ctx.font = `${TEXT_FONT_SIZE}px sans-serif`
          ctx.fillStyle = TEXT_MAIN
          ctx.fillText(label, textX, baseY)
        }
      })
      y += panelH + SECTION_GAP
      continue
    }

    const cellH = sectionCellHeight(section)
    const rows = section.rows ?? []
    const rowCount = Math.max(1, Math.ceil(rows.length / 2))
    rows.forEach((row, i) => {
      const col = i % 2
      const rowIdx = Math.floor(i / 2)
      const x = M + col * (cellW + GRID_GAP)
      drawCell(ctx, x, y + rowIdx * (cellH + CELL_GAP), cellW, cellH, row, iconImgs)
    })
    y += rowCount * cellH + (rowCount - 1) * CELL_GAP + SECTION_GAP
  }

  // 水印：金色高亮胶囊（淡金底 + 细描边 + 金色文字，克制不突兀）
  if (data.includeWatermark) {
    const text = watermarkText()
    ctx.font = '22px sans-serif'
    const textW = ctx.measureText(text).width
    const padX = 34
    const pillW = Math.min(textW + padX * 2, width - M * 2 - 24)
    const pillH = 52
    const pillX = (width - pillW) / 2
    // 减小内容区到水印的间距（原 24 → 16），底部留白由 FOOTER_H 保证
    const pillY = y + 16
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fillStyle = 'rgba(201,168,108,0.1)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(201,168,108,0.38)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, width / 2, pillY + pillH / 2)
    ctx.textBaseline = 'alphabetic'
  }
}

function loadCanvasImage(
  canvas: WechatMiniprogram.Canvas,
  src: string,
): Promise<WechatMiniprogram.Image> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo 加载失败'))
    img.src = src
  })
}

function exportCanvas(canvas: WechatMiniprogram.Canvas, target: PosterTarget): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath(
      {
        canvas,
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        destWidth: canvas.width,
        destHeight: canvas.height,
        fileType: 'png',
        success: (res) => resolve(res.tempFilePath),
        fail: () => reject(new Error('生成失败，请重试')),
      },
      // 自定义组件内操作画布：传入组件实例（官方文档要求）
      target as WechatMiniprogram.Component.TrivialInstance,
    )
  })
}

type PosterTarget = { createSelectorQuery(): WechatMiniprogram.SelectorQuery }

/**
 * 渲染分享海报并导出临时文件。
 * 调用方需在模板中放置 <canvas type="2d" id="shareCanvas" class="share-canvas-hidden">。
 * @param target 组件 / 页面实例（用于 createSelectorQuery 定位画布）
 * @param options.chart 可选内嵌图表（K 线走势），绘制在头部与数据分区之间
 */
export function renderSharePoster(
  target: PosterTarget,
  data: PosterData,
  options?: { chart?: PosterChart },
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      target
        .createSelectorQuery()
        .select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0]
          const canvas = info && (info.node as WechatMiniprogram.Canvas | undefined)
          if (!canvas) {
            reject(new Error('画布未就绪，请重试'))
            return
          }
          const dpr = wx.getWindowInfo().pixelRatio || 2
          const width = POSTER_WIDTH
          // 设置画布尺寸会重置 2d 上下文状态，因此先用探针 ctx 测量总高度
          // （含文本分区的真实换行行数），再 resize 画布并重新取 ctx。
          const probe = canvas.getContext('2d')
          const height = measurePosterHeight(data, options?.chart, probe)
          // Canvas 2D 画布物理像素单边上限 8192（微信限制，超出抛
          // 「set height out of range」），分区多 / 内嵌 K 线图的海报易触顶：
          // 超出时整体等比缩小（长宽同比例），保证画布创建成功且海报完整可导出。
          const MAX_CANVAS_PX = 8192
          const scale = Math.min(1, MAX_CANVAS_PX / (height * dpr), MAX_CANVAS_PX / (width * dpr))
          canvas.width = Math.floor(width * dpr * scale)
          canvas.height = Math.floor(height * dpr * scale)
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr * scale, dpr * scale)

          // 收集需要绘制的行图标（本地静态图片），与头部 logo 一起预加载
          const iconPaths: string[] = []
          const seen = new Set<string>()
          for (const section of data.sections ?? []) {
            for (const row of section.rows ?? []) {
              if (row.iconImage && !seen.has(row.iconImage)) {
                seen.add(row.iconImage)
                iconPaths.push(row.iconImage)
              }
            }
          }
          const loadLogo = loadCanvasImage(canvas, LOGO_PATH).catch(() => null)
          const loadIcons = iconPaths.map((p) =>
            loadCanvasImage(canvas, p)
              .then((img) => [p, img] as const)
              .catch(() => null),
          )
          Promise.all([loadLogo, ...loadIcons])
            .then((results) => {
              const logo = results[0] as WechatMiniprogram.Image | null
              const iconImgs: Record<string, WechatMiniprogram.Image> = {}
              for (const pair of results.slice(1) as Array<
                readonly [string, WechatMiniprogram.Image] | null
              >) {
                if (pair) iconImgs[pair[0]] = pair[1]
              }
              // logo 加载失败不阻塞：占位绘制后继续导出
              drawPoster(ctx, data, width, logo, options?.chart, iconImgs)
            })
            .then(() => exportCanvas(canvas, target))
            .then(resolve, reject)
        })
    } catch (e) {
      reject(e instanceof Error ? e : new Error('生成失败，请重试'))
    }
  })
}
