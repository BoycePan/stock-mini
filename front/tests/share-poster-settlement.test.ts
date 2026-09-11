import assert from 'node:assert/strict'
import test from 'node:test'

import { renderSharePoster, type PosterData } from '../utils/share-poster.ts'

/**
 * 海报生成的「Promise 必须落地」回归。
 *
 * 历史缺陷：renderSharePoster 的 try/catch 只包住 `createSelectorQuery().exec(cb)` 这个
 * **调用**，而绘制逻辑在异步回调体内。回调内一旦抛错（canvas 上下文不可用、绘制方法抛错、
 * wx.getWindowInfo 不可用等），Promise 既不 resolve 也不 reject（永久 pending）→
 * 调用方 .catch 兜底全部失效：shareLoading 永久为 true（分享入口被自身守卫永久挡住）、
 * wx.showLoading({ mask: true }) 遮罩永不关闭，用户只能重启小程序。
 *
 * 因此这里不只看「有没有 reject」，还断言「在限定时间内落地」——用 race 加超时，
 * 若 Promise 挂起则用例失败，而不是把整个测试进程拖住。
 */

const POSTER_DATA: PosterData = {
  title: '全球市场行情',
  subtitle: '市场追踪助手',
  statusText: '全球市场',
  stamp: '2026-08-26 18:00',
  includeWatermark: true,
  sections: [
    {
      title: 'A股指数',
      rows: [{ name: '上证指数', value: '3,200.00', changeText: '+0.52%', tone: 'up' }],
    },
  ],
}

/** renderSharePoster 的 target 形参类型（PosterTarget 未导出，用 Parameters 取） */
type PosterTargetLike = Parameters<typeof renderSharePoster>[0]

interface RenderedRequest {
  tempFilePath?: string
  success?: (res: { tempFilePath: string }) => void
}

interface WxProbe {
  exported: string[]
  unlinked: string[]
}

/** 安装 wx mock：getWindowInfo / canvasToTempFilePath / unlink，返回探针用于断言 */
function installWx(options: { getWindowInfo?: () => { pixelRatio: number } } = {}): WxProbe {
  const probe: WxProbe = { exported: [], unlinked: [] }
  let seq = 0
  ;(globalThis as Record<string, unknown>).wx = {
    getWindowInfo: options.getWindowInfo ?? (() => ({ pixelRatio: 2 })),
    getFileSystemManager: () => ({
      unlink: (opts: { filePath: string }) => {
        probe.unlinked.push(opts.filePath)
      },
    }),
    canvasToTempFilePath: (opts: RenderedRequest) => {
      seq += 1
      const path = `/tmp/poster-${seq}.png`
      probe.exported.push(path)
      opts.success?.({ tempFilePath: path })
    },
  }
  return probe
}

/**
 * 用 Proxy 构造「万能」2D 上下文：未显式定义的方法一律为 no-op，且返回值是一个
 * 可继续 addColorStop 的渐变占位对象（drawPoster 会用到 createRadialGradient /
 * createLinearGradient），便于让绘制流程走到底而不需要逐个实现 30+ 个 canvas API。
 */
function fakeCtx(overrides: Record<string, unknown> = {}): unknown {
  const gradientLike = { addColorStop: () => undefined }
  const base: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    createLinearGradient: () => gradientLike,
    createRadialGradient: () => gradientLike,
    ...overrides,
  }
  return new Proxy(base, {
    get: (target, key) => (key in target ? target[key as string] : () => gradientLike),
    set: (target, key, value) => {
      target[String(key)] = value
      return true
    },
  })
}

/** 假 canvas：createImage 返回的图片在 src 赋值后异步触发 onload（与微信行为一致） */
function fakeCanvas(ctx: unknown): unknown {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    createImage: () => {
      const img: Record<string, unknown> = { width: 40, height: 40, onload: null, onerror: null }
      Object.defineProperty(img, 'src', {
        set() {
          queueMicrotask(() => {
            const onload = img.onload as (() => void) | null
            onload?.()
          })
        },
      })
      return img
    },
  }
}

/** selector query：exec 回调返回给定 canvas 节点（结构按被测代码实际调用链模拟，故经 unknown 转换） */
function targetWithCanvas(node: unknown): PosterTargetLike {
  const query = {
    select: () => ({
      fields: () => ({
        exec: (cb: (res: unknown[]) => void) => cb([{ node }]),
      }),
    }),
  }
  return {
    createSelectorQuery: () =>
      query as unknown as ReturnType<PosterTargetLike['createSelectorQuery']>,
  }
}

/** 断言 Promise 在限定时间内落地（避免用例自身被挂起的 Promise 拖死） */
async function settledWithin(promise: Promise<unknown>, ms = 1000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

test('成功路径：resolve 出临时图路径并导出一次', async () => {
  const probe = installWx()
  const promise = renderSharePoster(targetWithCanvas(fakeCanvas(fakeCtx())), POSTER_DATA)
  const path = await promise
  assert.match(path, /^\/tmp\/poster-\d+\.png$/)
  assert.deepEqual(probe.exported, [path])
})

test('画布节点缺失：reject 且不挂起', async () => {
  installWx()
  const promise = renderSharePoster(targetWithCanvas(undefined), POSTER_DATA)
  assert.equal(await settledWithin(promise), true)
  await assert.rejects(promise, /画布未就绪/)
})

test('canvas.getContext 返回 null：reject 且不挂起（此前会永久 pending）', async () => {
  installWx()
  const canvas = { width: 0, height: 0, getContext: () => null }
  const promise = renderSharePoster(targetWithCanvas(canvas), POSTER_DATA)
  // 关键断言：必须落地（历史缺陷下此 Promise 永不 settle，调用方遮罩无法关闭）
  assert.equal(await settledWithin(promise), true)
  await assert.rejects(promise, /画布上下文不可用/)
})

test('绘制期抛错：reject 且不挂起（异常不再逃出回调体）', async () => {
  installWx()
  const ctx = fakeCtx({
    scale: () => {
      throw new Error('scale boom')
    },
  })
  const promise = renderSharePoster(targetWithCanvas(fakeCanvas(ctx)), POSTER_DATA)
  assert.equal(await settledWithin(promise), true)
  await assert.rejects(promise, /scale boom/)
})

test('wx.getWindowInfo 不可用：reject 且不挂起', async () => {
  installWx({
    getWindowInfo: () => {
      throw new Error('getWindowInfo unsupported')
    },
  })
  const promise = renderSharePoster(targetWithCanvas(fakeCanvas(fakeCtx())), POSTER_DATA)
  assert.equal(await settledWithin(promise), true)
  await assert.rejects(promise, /getWindowInfo unsupported/)
})

test('画布物理像素双重上限：单边 ≤8192 且总像素 ≤400 万（防 dpr=3 下约 65MB 位图）', async () => {
  installWx({ getWindowInfo: () => ({ pixelRatio: 3 }) })
  // 构造高海报：多段文本分区（真实场景如「分区多 + 内嵌 K 线图」）
  const bigData: PosterData = {
    title: '全球市场行情',
    subtitle: '市场追踪助手',
    statusText: '全球市场',
    heroText: '今日全球主要市场综述',
    stamp: '2026-08-26 18:00',
    includeWatermark: true,
    sections: Array.from({ length: 12 }, (_, i) => ({
      title: `分区 ${i + 1}`,
      text: '这是一段用于撑高海报的说明文字，长度接近真实分区描述。'.repeat(3),
    })),
  }
  let canvasSize = { width: 0, height: 0 }
  const canvas = {
    get width() {
      return canvasSize.width
    },
    set width(v: number) {
      canvasSize.width = v
    },
    get height() {
      return canvasSize.height
    },
    set height(v: number) {
      canvasSize.height = v
    },
    getContext: () => fakeCtx(),
    createImage: () => {
      const img: Record<string, unknown> = { width: 40, height: 40, onload: null, onerror: null }
      Object.defineProperty(img, 'src', {
        set() {
          queueMicrotask(() => (img.onload as (() => void) | null)?.())
        },
      })
      return img
    },
  }

  await renderSharePoster(targetWithCanvas(canvas), bigData)
  const area = canvasSize.width * canvasSize.height
  assert.ok(canvasSize.width <= 8192, `单边不得超 8192，实际 ${canvasSize.width}`)
  assert.ok(canvasSize.height <= 8192, `单边不得超 8192，实际 ${canvasSize.height}`)
  assert.ok(area <= 4_000_000, `总像素不得超 400 万，实际 ${area}`)
  // 缩放后仍需是可分享的清晰度（导出宽 ≥ 设计宽 750）
  assert.ok(canvasSize.width >= 750, `导出宽不得小于设计宽，实际 ${canvasSize.width}`)
})

test('重复生成会回收上一张临时图（避免临时目录累积数 MB PNG）', async () => {
  const probe = installWx()
  const target = targetWithCanvas(fakeCanvas(fakeCtx()))

  // 说明：lastPosterPath 是模块级状态，可能仍保留上一个用例导出的文件；
  // 因此只断言「每次新图导出成功后，恰好回收上一次返回的那张」这一增量语义。
  const first = await renderSharePoster(target, POSTER_DATA)
  const second = await renderSharePoster(target, POSTER_DATA)
  assert.notEqual(second, first, '第二次应导出新文件')
  assert.equal(probe.unlinked.at(-1), first, '第二次生成成功后回收第一张')

  const third = await renderSharePoster(target, POSTER_DATA)
  assert.equal(probe.unlinked.at(-1), second, '第三次生成回收第二张，始终只保留最新一张')
  assert.ok(!probe.unlinked.includes(third), '最新一张不会被提前回收（预览 / 保存相册仍需它）')
  assert.deepEqual(probe.exported.slice(-3), [first, second, third])
})
