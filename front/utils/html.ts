/**
 * 新闻摘要 HTML 处理工具。
 *
 * 后端 / 第三方源返回的新闻摘要为富文本 HTML（p / h2 / strong / img / br 等），
 * 小程序不能直接当文本渲染，这里提供两条路径：
 * - stripHtml：去掉标签得到纯文本，用于列表页摘要预览（配合行数截断，避免展示标签原文）；
 * - sanitizeRichHtml：清洗后交给 <rich-text> 渲染，用于详情页正文（保留段落 / 标题 / 加粗 / 图片，
 *   同时注入随主题变化的文字颜色，保证深浅色下均可读）。
 */

export interface RichHtmlTheme {
  /** 正文文字颜色 */
  text: string
  /** 链接颜色 */
  link: string
  /** 标题（h1-h6）颜色 */
  heading: string
}

export const RICH_HTML_LIGHT_THEME: RichHtmlTheme = {
  text: '#3d4c63',
  link: '#2f6fed',
  heading: '#1c2a3e',
}

export const RICH_HTML_DARK_THEME: RichHtmlTheme = {
  text: '#dfe6f0',
  link: '#6fa3ff',
  heading: '#f5f7fb',
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  times: '×',
  divide: '÷',
  middot: '·',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
}

/** 解码常见 HTML 实体（含 &#NN; 与 &#xHH; 数字实体），未知实体原样保留 */
export function decodeHtmlEntities(input: string): string {
  if (!input) return ''
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch {
        return ''
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10))
      } catch {
        return ''
      }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => HTML_ENTITIES[name] ?? match)
}

/**
 * 将 HTML 摘要转为纯文本：移除标签、解码实体、压缩空白。
 * 用于列表页两行截断的摘要预览（不可直接渲染的 <text> 场景）。
 */
export function stripHtml(html: string): string {
  if (!html) return ''
  const text = decodeHtmlEntities(
    html
      // 先整体移除不可见内容块（含其内部文本）
      .replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1>/gi, ' ')
      // 块级 / 换行标签替换为空格，避免「标题正文」粘连成一句
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, ' ')
      // 其余标签直接去掉
      .replace(/<[^>]+>/g, ''),
  )
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------
// rich-text 清洗
// ---------------------------------------------------------------------------

/** 整体移除（含内容）的危险 / 不可见标签 */
const REMOVE_BLOCK_RE =
  /<(script|style|iframe|object|embed|head|link|meta|title|base|form|input|button|select|textarea|svg|canvas|noscript|frame|frameset)(\s[^<>]*)?>[\s\S]*?<\/\1>|<(script|style|iframe|object|embed|head|link|meta|title|base|form|input|button|select|textarea|svg|canvas|noscript|frame|frameset)(\s[^<>]*)?\/?>/gi

/** rich-text 组件支持的标签白名单（超出部分剥掉标签、保留内容） */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'label',
  'legend',
  'li',
  'ol',
  'p',
  'q',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/** 需要注入主题色 / 排版样式的文字类标签 */
const TEXT_TAGS = new Set([
  'p',
  'span',
  'div',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'blockquote',
  'q',
  'del',
  'ins',
  'td',
  'th',
  'dd',
  'dt',
  'legend',
  'label',
  'code',
  'sub',
  'sup',
  'a',
])

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** 块级文字标签：未显式声明字号时统一注入，保证 rich-text 排版一致（行内标签随父级继承） */
const BLOCK_FONT_TAGS = new Set([
  'p',
  'div',
  'li',
  'blockquote',
  'td',
  'th',
  'dd',
  'dt',
  'legend',
  'label',
  'code',
])

const BODY_FONT_SIZE = '15px'
const BODY_LINE_HEIGHT = '1.8'
const HEADING_FONT_SIZES: Record<string, string> = {
  h1: '22px',
  h2: '19px',
  h3: '17px',
  h4: '16px',
  h5: '15px',
  h6: '15px',
}

const HEADING_LINE_HEIGHTS: Record<string, string> = {
  h1: '1.4',
  h2: '1.4',
  h3: '1.4',
  h4: '1.5',
  h5: '1.5',
  h6: '1.5',
}

function parseAttrs(attrStr: string): Map<string, string> {
  const attrs = new Map<string, string>()
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(attrStr)) !== null) {
    const key = match[1]!.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs.set(key, value)
  }
  return attrs
}

function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of style.split(';')) {
    const idx = part.indexOf(':')
    if (idx > 0) {
      const key = part.slice(0, idx).trim().toLowerCase()
      const value = part.slice(idx + 1).trim()
      if (key && value) out[key] = value
    }
  }
  return out
}

function buildStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const DANGEROUS_URL = /^(javascript|data|vbscript)\s*:/i

/**
 * 清洗 HTML 供 <rich-text> 渲染：
 * - 移除 script / style / iframe 等危险或不可见标签（含内容）；
 * - 白名单之外的标签剥掉、保留内容；
 * - 剥除 class / id / on* / data-* 等属性，仅保留 src / href / alt 等安全属性；
 * - img 注入自适应宽度与圆角，防止大图撑爆卡片；
 * - 文字类标签注入随主题变化的 color（作者自带颜色保留），保证深浅色下可读。
 */
export function sanitizeRichHtml(html: string, theme: RichHtmlTheme): string {
  if (!html || !/<[a-zA-Z]/.test(html)) return html.trim()
  return html
    .replace(REMOVE_BLOCK_RE, ' ')
    .replace(
      /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)\/?>/g,
      (match, tagName: string, attrStr: string) => {
        const tag = tagName.toLowerCase()
        const isClosing = match.startsWith('</')
        if (isClosing) return ALLOWED_TAGS.has(tag) ? `</${tag}>` : ''
        if (!ALLOWED_TAGS.has(tag)) return ''
        if (tag === 'br') return '<br>'
        if (tag === 'hr')
          return `<hr style="border:none;border-top:1px solid ${theme === RICH_HTML_DARK_THEME ? '#2a394e' : '#e2eaf3'};margin:20px 0;">`

        const attrs = parseAttrs(attrStr)
        const style = parseStyle(attrs.get('style') ?? '')

        if (tag === 'img') {
          const src = attrs.get('src') ?? ''
          if (!src || DANGEROUS_URL.test(src)) return ''
          const merged = {
            display: 'block',
            'max-width': '100%',
            height: 'auto',
            'border-radius': '12px',
            margin: '16px auto',
            ...style,
          }
          const alt = attrs.get('alt')
          const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : ''
          return `<img src="${escapeAttr(src)}"${altAttr} style="${buildStyle(merged)}">`
        }

        if (tag === 'a') {
          const href = attrs.get('href') ?? ''
          const merged = {
            color: theme.link,
            'text-decoration': 'none',
            ...style,
          }
          const safeHref = href && !DANGEROUS_URL.test(href) ? escapeAttr(href) : '#'
          return `<a href="${safeHref}" style="${buildStyle(merged)}">`
        }

        if (TEXT_TAGS.has(tag)) {
          // 未显式指定颜色时注入主题色；作者自带的颜色（涨红跌绿等）保留
          if (!style.color) {
            style.color = HEADING_TAGS.has(tag) ? theme.heading : theme.text
          }
          // 块级标签统一字号 / 行高 / 间距，保证排版舒展且深浅色下一致
          if (HEADING_TAGS.has(tag)) {
            if (!style['font-size']) style['font-size'] = HEADING_FONT_SIZES[tag] ?? BODY_FONT_SIZE
            if (!style['font-weight']) style['font-weight'] = '700'
            if (!style['line-height']) style['line-height'] = HEADING_LINE_HEIGHTS[tag] ?? '1.4'
            if (!style['margin-top']) style['margin-top'] = '20px'
            if (!style['margin-bottom']) style['margin-bottom'] = '10px'
          } else if (BLOCK_FONT_TAGS.has(tag)) {
            if (!style['font-size']) style['font-size'] = BODY_FONT_SIZE
            if (!style['line-height']) style['line-height'] = BODY_LINE_HEIGHT
            // 段落间距 + 首行缩进
            if ((tag === 'p' || tag === 'div') && !style['margin-bottom']) {
              style['margin-bottom'] = '16px'
            }
            if (tag === 'p' && !style['text-indent']) {
              style['text-indent'] = '2em'
            }
            // 引用块装饰
            if (tag === 'blockquote') {
              if (!style['border-left'])
                style['border-left'] =
                  `3px solid ${theme === RICH_HTML_DARK_THEME ? '#3b6fd6' : '#4278ed'}`
              if (!style['padding-left']) style['padding-left'] = '14px'
              if (!style['margin']) style['margin'] = '16px 0'
              if (!style['font-style']) style['font-style'] = 'italic'
              if (!style.color) style.color = theme === RICH_HTML_DARK_THEME ? '#9cacc0' : '#718096'
            }
            // 代码块
            if (tag === 'code') {
              if (!style['background'])
                style['background'] = theme === RICH_HTML_DARK_THEME ? '#1a2637' : '#f2f6fa'
              if (!style['border-radius']) style['border-radius'] = '4px'
              if (!style['padding']) style['padding'] = '2px 6px'
              if (!style['font-size']) style['font-size'] = '15px'
            }
          }
          const styleAttr = buildStyle(style)
          return `<${tag} style="${styleAttr}">`
        }

        // 其余白名单标签（table 等）：保留作者样式，不做颜色注入
        const styleAttr = buildStyle(style)
        return styleAttr ? `<${tag} style="${styleAttr}">` : `<${tag}>`
      },
    )
}

/**
 * 根据主题构建详情页可渲染的富文本。
 * 摘要不含 HTML（纯文本）时返回空串，调用方应回退到普通 <text> 展示。
 */
export function buildRichHtml(summary: string, theme: 'light' | 'dark'): string {
  if (!summary || !/<[a-zA-Z]/.test(summary)) return ''
  return sanitizeRichHtml(summary, theme === 'dark' ? RICH_HTML_DARK_THEME : RICH_HTML_LIGHT_THEME)
}
