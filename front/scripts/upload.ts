#!/usr/bin/env node
/**
 * 小程序自动上传 / 预览脚本（基于 miniprogram-ci@2.x）
 *
 * 前置条件：
 *   1. 在「微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传」生成上传密钥，
 *      并将执行环境的出口 IP 加入该密钥的 IP 白名单；
 *   2. 将密钥保存到 front/keys/private.key 或仓库根目录 keys/private.<appid>.key
 *      （两者均已 gitignore），或通过环境变量传入。
 *
 * 用法（仓库根目录执行）：
 *   pnpm upload                              # 上传为开发版本（默认 1 号机器人）
 *   pnpm upload -- --version=1.2.0 --desc=发版  # pnpm 透传参数需用 -- 分隔
 *   pnpm upload:preview -- --page=pages/global/index   # 生成预览二维码
 *   pnpm upload -- --dry-run                    # 只校验配置与密钥，不上传
 *
 * 环境变量（优先级：命令行参数 > 环境变量 > 项目配置）：
 *   WX_APPID            小程序 appid（默认读 project.config.json）
 *   WX_PRIVATE_KEY      上传密钥内容（GitHub Actions 等 CI 推荐，避免提交密钥文件）
 *   WX_PRIVATE_KEY_PATH 上传密钥文件路径（默认依次查找 front/keys/private.key、
 *                        keys/private.<appid>.key）
 *   WX_VERSION          上传版本号（默认仓库根 package.json 的 version；微信要求唯一，重复会报错）
 *   WX_UPLOAD_DESC      上传备注
 *   WX_ROBOT            上传机器人编号 1-30（默认 1）
 *   WX_CI_MODE          preview | upload
 *   WX_NO_MINIFY        置 1 时跳过 JS/WXML/WXSS 压缩
 *   WX_CI_PROXY         HTTP 代理地址（如 http://user:pass@host:port，用于固定出口 IP）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// miniprogram-ci 是 CommonJS 包，用 createRequire 引入，运行时行为与类型声明都可确定
const require = createRequire(import.meta.url)
const ci = require('miniprogram-ci') as typeof import('miniprogram-ci')

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..')

type ProjectOptions = ConstructorParameters<typeof ci.Project>[0]
type UploadOptions = Parameters<typeof ci.upload>[0]
type ProgressTask = NonNullable<UploadOptions['onProgressUpdate']>

interface CliOptions {
  mode: 'upload' | 'preview'
  appid?: string
  privateKeyPath?: string
  version?: string
  desc?: string
  robot?: number
  minify: boolean
  pagePath?: string
  searchQuery?: string
  qrcodeFormat?: 'base64' | 'image' | 'terminal'
  qrcodeOutputDest?: string
  help?: boolean
  dryRun?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: 'upload', minify: true }
  for (const arg of argv) {
    if (arg === '--') continue // pnpm 透传参数时用 -- 分隔
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--preview') {
      options.mode = 'preview'
      continue
    }
    if (arg === '--no-minify') {
      options.minify = false
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    const eqIndex = arg.indexOf('=')
    if (eqIndex <= 0) throw new Error(`无法识别的参数：${arg}（使用 --key=value 形式）`)
    const key = arg.slice(0, eqIndex)
    const value = arg.slice(eqIndex + 1)
    switch (key) {
      case '--version':
        options.version = value
        break
      case '--desc':
        options.desc = value
        break
      case '--robot':
        options.robot = Number(value)
        break
      case '--appid':
        options.appid = value
        break
      case '--private-key':
        options.privateKeyPath = value
        break
      case '--page':
        options.pagePath = value
        break
      case '--query':
        options.searchQuery = value
        break
      case '--qrcode-format':
        options.qrcodeFormat = value as CliOptions['qrcodeFormat']
        break
      case '--qrcode-output-dest':
        options.qrcodeOutputDest = value
        break
      default:
        throw new Error(`未知参数：${key}`)
    }
  }
  return options
}

function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function printHelp(): void {
  console.log(`用法：
  node scripts/upload.ts [选项]

选项：
  --preview                 生成预览二维码（默认上传）
  --version=<版本号>        上传版本号（默认仓库根 package.json 的 version）
  --desc=<备注>             上传备注
  --robot=<1-30>            上传机器人编号（默认 1）
  --appid=<appid>           小程序 appid（默认 project.config.json）
  --private-key=<路径>      上传密钥文件路径（默认自动查找 front/keys/private.key、\n                            keys/private.<appid>.key）
  --page=<页面路径>         （preview）指定预览页面
  --query=<参数>            （preview）预览页面 query，如 a=1&b=2
  --qrcode-format=terminal|base64|image
  --qrcode-output-dest=<路径>  二维码输出位置（image 格式需要）
  --no-minify               不压缩 JS/WXML/WXSS
  --dry-run                 只校验 appid / 密钥 / 项目结构，不真正上传
  --help                    显示帮助

环境变量（优先级：命令行参数 > 环境变量 > 项目配置）：
  WX_APPID WX_PRIVATE_KEY WX_PRIVATE_KEY_PATH WX_VERSION WX_UPLOAD_DESC
  WX_ROBOT WX_CI_MODE WX_NO_MINIFY WX_CI_PROXY`)
}

const onProgressUpdate: ProgressTask = (task) => {
  if (typeof task === 'string') {
    console.log(`[ci] ${task}`)
    return
  }
  const icon =
    task.status === 'done' ? '✓' : task.status === 'fail' ? '✗' : task.status === 'warn' ? '⚠' : '·'
  if (task.message) console.log(`[ci] ${icon} ${task.message}`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (env('WX_CI_MODE') === 'preview') options.mode = 'preview'

  const projectConfig = readJson<{ appid?: string }>(path.join(PROJECT_ROOT, 'project.config.json'))
  const rootPkg = readJson<{ version?: string }>(path.join(REPO_ROOT, 'package.json'))
  const frontPkg = readJson<{ version?: string }>(path.join(PROJECT_ROOT, 'package.json'))

  const appid = options.appid ?? env('WX_APPID') ?? projectConfig.appid
  if (!appid) {
    throw new Error('未找到 appid：请在 project.config.json 中配置，或用 --appid / WX_APPID 指定')
  }

  // 版本号默认取仓库根 package.json 的 version（无则回退 front/package.json）
  const version =
    options.version ?? env('WX_VERSION') ?? rootPkg.version ?? frontPkg.version ?? '1.0.0'
  if (version.length > 32) throw new Error(`版本号过长（${version.length} > 32 字符）：${version}`)
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.warn(`[warn] 版本号 "${version}" 不是 x.y.z 数字格式，若被微信拒绝请改为如 1.0.1`)
  }

  const desc =
    options.desc ??
    env('WX_UPLOAD_DESC') ??
    `CI 自动构建 ${new Date().toLocaleString('zh-CN', { hour12: false })}`

  const robot = options.robot ?? Number(env('WX_ROBOT') ?? '1')
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) {
    throw new Error(`robot 必须是 1-30 的整数，当前：${robot}`)
  }

  const privateKey = env('WX_PRIVATE_KEY')
  const explicitKeyPath = options.privateKeyPath ?? env('WX_PRIVATE_KEY_PATH')
  const keyCandidates = [
    ...(explicitKeyPath ? [explicitKeyPath] : []),
    path.join(PROJECT_ROOT, 'keys', 'private.key'),
    path.join(REPO_ROOT, 'keys', `private.${appid}.key`),
  ]
  const privateKeyPath = keyCandidates.find((candidate) => fs.existsSync(candidate))

  const projectOptions: ProjectOptions = {
    appid,
    type: 'miniProgram',
    projectPath: PROJECT_ROOT,
    ignores: [
      'node_modules/**/*',
      'scripts/**/*',
      'tests/**/*',
      'keys/**/*',
      '*.md',
      'eslint.config.js',
      'prettier.config.js',
      'project.private.config.json',
      '**/.DS_Store',
    ],
  }
  if (privateKey) {
    projectOptions.privateKey = privateKey
  } else if (privateKeyPath) {
    projectOptions.privateKeyPath = privateKeyPath
  } else {
    throw new Error(
      `未找到上传密钥（已查找：${keyCandidates.join('、')}\n` +
        '请将微信公众平台生成的上传密钥放到上述任一位置，或用 WX_PRIVATE_KEY / --private-key 指定',
    )
  }

  const proxyUrl = env('WX_CI_PROXY')
  if (proxyUrl) ci.proxy(proxyUrl)

  const minify = options.minify && env('WX_NO_MINIFY') !== '1'
  const setting: NonNullable<UploadOptions['setting']> = {
    useProjectConfig: false,
    es6: true,
    es7: false,
    minify,
    codeProtect: false,
    minifyJS: minify,
    minifyWXML: minify,
    minifyWXSS: minify,
    autoPrefixWXSS: true,
    disableUseStrict: false,
  }

  console.log(`\n== 即将${options.mode === 'preview' ? '预览' : '上传'}小程序 ==`)
  console.log(`  appid : ${appid}`)
  console.log(`  版本号: ${version}`)
  console.log(`  机器人: ${robot}`)
  console.log(`  备注  : ${desc}`)
  console.log(`  密钥  : ${privateKey ? '<WX_PRIVATE_KEY 环境变量>' : privateKeyPath}`)
  console.log(`  压缩  : ${minify ? '是' : '否'}`)
  if (options.mode === 'preview' && options.pagePath) console.log(`  预览页: ${options.pagePath}`)
  console.log('')

  const project = new ci.Project(projectOptions)

  if (options.dryRun) {
    console.log('\n配置校验通过（dry-run）：')
    console.log(`  项目路径: ${PROJECT_ROOT}`)
    console.log(
      `  密钥     : ${privateKey ? '<WX_PRIVATE_KEY 环境变量>' : projectOptions.privateKeyPath}`,
    )
    console.log(`  appid 与密钥匹配，项目结构完整，未执行实际上传`)
    return
  }

  if (options.mode === 'preview') {
    await ci.preview({
      project,
      setting,
      version,
      desc,
      robot,
      onProgressUpdate,
      pagePath: options.pagePath,
      searchQuery: options.searchQuery,
      qrcodeFormat: options.qrcodeFormat,
      qrcodeOutputDest: options.qrcodeOutputDest,
    })
    console.log('\n预览二维码已生成，可在上方日志中找到二维码地址/文件')
  } else {
    await ci.upload({ project, setting, version, desc, robot, onProgressUpdate })
    console.log('\n上传成功！可在「微信公众平台 → 版本管理 → 开发版本」中查看')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n执行失败：${message}`)
  if (/ip/i.test(message) || message.includes('白名单')) {
    console.error(
      '提示：请将当前执行环境的出口 IP 加入上传密钥的 IP 白名单（微信公众平台 → 开发设置 → 小程序代码上传）',
    )
  }
  if (message.includes('版本号')) {
    console.error('提示：版本号需唯一且格式如 1.0.1，可通过 --version= 或 WX_VERSION 指定')
  }
  process.exitCode = 1
})
