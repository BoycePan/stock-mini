import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRichHtml,
  decodeHtmlEntities,
  MAX_RICH_HTML_CHARS,
  MAX_RICH_IMAGES,
  RICH_HTML_DARK_THEME,
  RICH_HTML_LIGHT_THEME,
  sanitizeRichHtml,
  stripHtml,
  truncateRichHtml,
} from '../utils/html.ts'

test('stripHtml: 移除标签、解码实体、压缩空白', () => {
  const html =
    '<p style="text-align: left;">A&amp;B &#34;quote&#34;<strong>加粗</strong></p><br><img src="https://img">'
  assert.equal(stripHtml(html), 'A&B "quote"加粗')
})

test('stripHtml: 电报式摘要（含 br 与 img）只保留正文', () => {
  const summary =
    '【云意电气：拟发行不超15.47亿元可转债】财联社8月20日电，云意电气公告称，公司拟向不特定对象发行可转换公司债券。<br><img src="https://image.cls.cn/1.png" referrerpolicy="no-referrer">'
  assert.equal(
    stripHtml(summary),
    '【云意电气：拟发行不超15.47亿元可转债】财联社8月20日电，云意电气公告称，公司拟向不特定对象发行可转换公司债券。',
  )
})

test('stripHtml: 长文摘要按块级标签切分，不粘连', () => {
  const html =
    '<h2 style="text-align: left;">AI算力驱动PCB设备放量</h2><p style="text-align: left;">PCB设备是核心引擎。</p><p><strong>公司实现量产。</strong></p>'
  assert.equal(stripHtml(html), 'AI算力驱动PCB设备放量 PCB设备是核心引擎。 公司实现量产。')
})

test('decodeHtmlEntities: 数字与命名实体', () => {
  assert.equal(decodeHtmlEntities('&#34;a&#34; &amp; &#x4e2d; &nbsp;&lt;b&gt;'), '"a" & 中  <b>')
})

test('sanitizeRichHtml: 移除危险标签、注入主题色与图片自适应', () => {
  const html =
    '<script>alert(1)</script><p style="text-align: left;">正文<strong>强调</strong></p><img src="https://img/a.png" referrerpolicy="no-referrer" class="wscnph" style="height:100px">'
  const out = sanitizeRichHtml(html, RICH_HTML_LIGHT_THEME)
  assert.ok(!out.includes('script'), 'script 标签应被移除')
  assert.ok(!out.includes('referrerpolicy'), '非白名单属性应被移除')
  assert.ok(!out.includes('class='), 'class 属性应被移除')
  assert.ok(out.includes(`color:${RICH_HTML_LIGHT_THEME.text}`), '正文应注入浅色主题文字颜色')
  assert.ok(out.includes('max-width:100%'), '图片应注入自适应宽度')
  assert.ok(out.includes('border-radius:12px'), '图片应注入圆角')
})

test('sanitizeRichHtml: 深色主题注入深色文字颜色', () => {
  const out = sanitizeRichHtml('<p>正文</p><h2>标题</h2>', RICH_HTML_DARK_THEME)
  assert.ok(out.includes(`color:${RICH_HTML_DARK_THEME.text}`))
  assert.ok(out.includes(`color:${RICH_HTML_DARK_THEME.heading}`))
})

test('sanitizeRichHtml: 作者自带颜色保留', () => {
  const out = sanitizeRichHtml('<p style="color:#eb514d">红字</p>', RICH_HTML_LIGHT_THEME)
  assert.ok(out.includes('color:#eb514d'))
})

test('sanitizeRichHtml: 未知标签剥掉、保留内容；危险链接被中和', () => {
  const out = sanitizeRichHtml(
    '<center><font>内容</font></center><a href="javascript:alert(1)">链接</a>',
    RICH_HTML_LIGHT_THEME,
  )
  assert.ok(out.includes('内容'))
  assert.ok(!out.includes('<center') && !out.includes('<font'))
  assert.ok(out.includes('href="#"'), '危险链接应被中和')
})

test('buildRichHtml: 纯文本摘要返回空串（回退普通 text 渲染）', () => {
  assert.equal(buildRichHtml('这是一段纯文本', 'light'), '')
  assert.equal(buildRichHtml('', 'light'), '')
  assert.ok(buildRichHtml('<p>有标签</p>', 'dark').includes('<p'))
})

test('sanitizeRichHtml: 压缩冗余空段与段落间距', () => {
  const html =
    '<p>第一段</p><p><br></p><p>&nbsp;</p><p>第二段<br><br><br>第二段内容</p><p><br>第三段</p>'
  const out = sanitizeRichHtml(html, RICH_HTML_LIGHT_THEME)
  assert.ok(out.includes('margin-bottom:8px'), '段落间距应使用紧凑的 8px')
  assert.ok(!out.includes('<p style="margin-bottom:8px;font-size:15px;line-height:1.6"><br></p>'))
  assert.ok(!out.includes('<br><br>'), '连续多余 br 应被合并')
})

test('sanitizeRichHtml: 图片数量默认上限（防 WebView 全尺寸解码撑爆内存）', () => {
  const html = Array.from({ length: 6 }, (_, i) => `<img src="https://img/a${i}.png">`).join('')
  const out = sanitizeRichHtml(html, RICH_HTML_LIGHT_THEME)
  assert.equal((out.match(/<img /g) ?? []).length, MAX_RICH_IMAGES, '默认最多保留 3 张图')
  const out2 = sanitizeRichHtml(html, RICH_HTML_LIGHT_THEME, { maxImages: 2 })
  assert.equal((out2.match(/<img /g) ?? []).length, 2, '自定义上限生效')
})

test('truncateRichHtml: 未超限原样返回（含空串）', () => {
  const html = '<p>正文</p>'
  assert.equal(truncateRichHtml(html), html)
  assert.equal(truncateRichHtml(''), '')
  assert.equal(truncateRichHtml('', 100), '')
})

test('truncateRichHtml: 超限截断到安全边界并追加省略号', () => {
  const long = '<p>' + '正'.repeat(30000) + '</p>'
  const out = truncateRichHtml(long, 2000)
  assert.ok(out.length <= 2001, '长度不超过上限 + 省略号')
  assert.ok(out.endsWith('…'))
  assert.ok(out.startsWith('<p>'), '开头标签保留')
})

test('truncateRichHtml: 截断点不在未闭合标签内', () => {
  // 截断点（2000）落在 <img src=" 属性内部 → 应回退到标签之前
  const long = '<img src="' + 'x'.repeat(5000) + '" alt="图">'
  const out = truncateRichHtml(long, 2000)
  assert.ok(out.endsWith('…'))
  assert.ok(!out.includes('<img'), '不应保留被切断的标签')
})

test('truncateRichHtml: 截断点不在实体内', () => {
  const long = '&nbsp;'.repeat(10000)
  const out = truncateRichHtml(long, 2000)
  assert.ok(out.endsWith(';…'), '实体应完整保留后再截断')
  const body = out.slice(0, -1)
  assert.ok(body.length % 6 === 0, '正文应为完整 &nbsp; 的整数倍')
})

test('truncateRichHtml: 不切出半个 emoji（UTF-16 代理对）', () => {
  const long = '😀'.repeat(20000)
  const out = truncateRichHtml(long, 2000)
  assert.ok(out.endsWith('…'))
  assert.ok((out.length - 1) % 2 === 0, '正文应为完整代理对的整数倍')
})

test('truncateRichHtml: 超大整篇文章 HTML 截断后输出有界（防内存溢出回归）', () => {
  const parts: string[] = []
  for (let i = 0; i < 20000; i++) {
    parts.push(
      `<p>第${i}段正文内容，包含中文与数字 1234567890 与标点符号，模拟完整文章。</p>` +
        (i % 5 === 0 ? '<img src="https://image.cls.cn/x.png" referrerpolicy="no-referrer">' : ''),
    )
  }
  const html = parts.join('')
  assert.ok(html.length > MAX_RICH_HTML_CHARS * 10, '用例应远超上限')
  const out = truncateRichHtml(html, MAX_RICH_HTML_CHARS)
  assert.ok(out.length <= MAX_RICH_HTML_CHARS + 1, '截断后长度有界')
  // 截断后交给 sanitize 再渲染，输出同样有界
  const rich = sanitizeRichHtml(out, RICH_HTML_LIGHT_THEME)
  assert.ok(rich.length > 0 && rich.length < MAX_RICH_HTML_CHARS * 4, '渲染输入有界')
})
