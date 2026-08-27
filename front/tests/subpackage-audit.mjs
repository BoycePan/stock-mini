// 分包改造审计脚本 v2：校验 app.json 结构、页面文件齐全性、usingComponents 解析、
// 导航/分享目标合法性、跨包静态引用规则。用法：node tests/subpackage-audit.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const errors = []
const ok = (msg) => console.log('  ✔ ' + msg)
const bad = (msg) => {
  errors.push(msg)
  console.log('  ✘ ' + msg)
}

function walkFiles(dir, ext) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, ext))
    else if (name.endsWith(ext)) out.push(p)
  }
  return out
}

// ---------- 1. app.json 结构 ----------
console.log('== app.json 分包结构 ==')
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'))
const mainPages = app.pages
const subpkgs = app.subpackages ?? app.subPackages ?? []
if (!Array.isArray(mainPages) || mainPages.length === 0) bad('app.json pages 为空')
else ok(`主包页面 ${mainPages.length} 个`)

const allPages = new Set(mainPages)
const seen = new Map()
for (const p of mainPages) seen.set(p, 'main')
for (const sp of subpkgs) {
  const root = sp.root
  if (!root) bad('subpackage 缺少 root')
  if (root === 'pages' || mainPages.some((p) => p.startsWith(root + '/')))
    bad(`分包 root 与主包冲突: ${root}`)
  for (const p of sp.pages) {
    const full = `${root}/${p}`
    if (seen.has(full)) bad(`页面重复声明: ${full}`)
    seen.set(full, root)
    allPages.add(full)
  }
  ok(`分包 ${root}（name=${sp.name ?? '-'}）页面 ${sp.pages.length} 个`)
}
if (!mainPages.includes('pages/global/index')) bad('冷启动页 pages/global/index 不在主包 pages 首位')
else ok('冷启动页 pages/global/index 在主包')
// preloadRule 校验
const pre = app.preloadRule ?? {}
for (const [page, cfg] of Object.entries(pre)) {
  if (!mainPages.includes(page)) bad(`preloadRule 入口不是主包页面: ${page}`)
  for (const pkg of cfg.packages ?? []) {
    if (pkg === '__APP__') continue
    if (!subpkgs.some((s) => s.root === pkg || s.name === pkg))
      bad(`preloadRule 引用了不存在的分包: ${page} -> ${pkg}`)
  }
}
ok(`preloadRule 校验完成（${Object.keys(pre).length} 条）`)

// ---------- 2. 页面文件齐全性 ----------
console.log('== 页面文件齐全性 ==')
for (const full of allPages) {
  for (const ext of ['ts', 'wxml', 'json', 'wxss']) {
    if (!existsSync(join(ROOT, ...full.split('/')) + '.' + ext))
      bad(`页面文件缺失: ${full}.${ext}`)
  }
}
ok(`全部 ${allPages.size} 个页面的 4 件套存在`)

// ---------- 3. usingComponents 解析 ----------
console.log('== usingComponents 解析 ==')
let compRefs = 0
const npmRoot = join(ROOT, 'miniprogram_npm')
for (const root of ['pages', 'packageQuote', 'packageNews', 'packageAbout', 'packageTreemap', 'components']) {
  const base = join(ROOT, root)
  if (!existsSync(base)) continue
  for (const jf of walkFiles(base, '.json')) {
    let cfg
    try {
      cfg = JSON.parse(readFileSync(jf, 'utf8'))
    } catch {
      bad(`JSON 解析失败: ${jf.slice(ROOT.length + 1)}`)
      continue
    }
    const ucs = cfg.usingComponents
    if (!ucs) continue
    for (const [tag, ref] of Object.entries(ucs)) {
      compRefs++
      let candidate
      if (ref.startsWith('/')) candidate = join(ROOT, ...ref.slice(1).split('/'))
      else if (ref.startsWith('./') || ref.startsWith('../')) candidate = resolve(dirname(jf), ref)
      else candidate = join(npmRoot, ...ref.split('/')) // npm 包：miniprogram_npm/<ref>
      if (!existsSync(candidate + '.json'))
        bad(`组件无法解析: ${jf.slice(ROOT.length + 1)} -> ${ref} (${tag})`)
    }
  }
}
ok(`校验 ${compRefs} 条 usingComponents 引用`)

// ---------- 4. 导航 / 分享目标合法性 ----------
console.log('== 导航 / 分享目标 ==')
const tsFiles = []
for (const root of ['pages', 'packageQuote', 'packageNews', 'packageAbout', 'packageTreemap', 'components', 'utils', 'custom-tab-bar']) {
  const base = join(ROOT, root)
  if (existsSync(base)) tsFiles.push(...walkFiles(base, '.ts'))
}
const targetSet = new Set([...allPages].map((p) => '/' + p))
const navRe = /wx\.(?:navigateTo|redirectTo|switchTab|reLaunch)\s*\(\s*\{\s*url\s*:\s*[`'"]([^`'"]+)[`'"]/g
let navChecked = 0
for (const tf of tsFiles) {
  const src = readFileSync(tf, 'utf8')
  let m
  while ((m = navRe.exec(src))) {
    navChecked++
    const url = m[1]
    if (url.startsWith('/')) {
      const pathPart = url.split('?')[0]
      if (pathPart.includes('${')) {
        // 动态模板目标：仅允许 switchTab 到主包 Tab 页（custom-tab-bar 的 tab key）
        if (!m[0].includes('switchTab'))
          bad(`动态导航目标非 switchTab: ${tf.slice(ROOT.length + 1)} -> ${url}`)
        continue
      }
      if (!targetSet.has(pathPart)) bad(`导航目标未声明: ${tf.slice(ROOT.length + 1)} -> ${url}`)
    }
  }
}
ok(`校验 ${navChecked} 处 wx.* 导航调用`)

const shareTs = readFileSync(join(ROOT, 'utils', 'share.ts'), 'utf8')
for (const m of shareTs.matchAll(/(['"])(\/package\w+\/pages\/[^'"]+)\1/g)) {
  if (!targetSet.has(m[2])) bad(`share.ts 路由未声明: ${m[2]}`)
}
ok('share.ts SHARE_TARGET_ROUTES 全部指向已声明页面')

const sharePathRe = /path\s*:\s*[`'"]([^`'"]+)[`'"]/g
for (const full of allPages) {
  const tsFile = join(ROOT, ...full.split('/')) + '.ts'
  if (!existsSync(tsFile)) continue
  const src = readFileSync(tsFile, 'utf8')
  let m
  while ((m = sharePathRe.exec(src))) {
    const p = m[1]
    if (p.startsWith('/') && !p.includes('${') && !targetSet.has(p.split('?')[0]))
      bad(`分享 path 未声明: ${full} -> ${p}`)
  }
}
ok('页面分享 path 校验完成')

// ---------- 5. 跨包静态引用规则 ----------
console.log('== 跨包静态引用规则 ==')
const subRoots = ['packageQuote', 'packageNews', 'packageAbout', 'packageTreemap']
const importRe = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
function checkImports(file, owner) {
  const src = readFileSync(file, 'utf8')
  let m
  while ((m = importRe.exec(src))) {
    const spec = m[1] || m[2]
    if (!spec) continue
    if (spec.startsWith('/')) {
      if (spec.includes('/package')) bad(`绝对路径导入分包: ${file.slice(ROOT.length + 1)} -> ${spec}`)
      continue
    }
    for (const r of subRoots) {
      if (spec.includes(r + '/') && owner !== r)
        bad(`跨包静态引用: ${owner === 'main' ? '主包' : owner} ${file.slice(ROOT.length + 1)} -> ${spec}`)
    }
  }
}
for (const root of ['pages', 'components', 'utils', 'stores', 'config', 'api', 'custom-tab-bar']) {
  const base = join(ROOT, root)
  if (existsSync(base)) for (const f of walkFiles(base, '.ts')) checkImports(f, 'main')
}
for (const f of tsFiles) {
  if (f.includes(sep + 'package')) {
    const pkg = f.split(sep).find((s) => subRoots.includes(s))
    checkImports(f, pkg)
  }
}
ok('跨包静态引用检查完成（主包不引分包、分包间不互引）')

console.log('\n========== 结果 ==========')
if (errors.length) {
  console.log(`发现 ${errors.length} 个问题:`)
  errors.forEach((e) => console.log('  ✘ ' + e))
  process.exit(1)
}
console.log('全部通过 ✔')
