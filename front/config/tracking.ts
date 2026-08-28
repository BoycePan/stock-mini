/**
 * 前端埋点（打点）配置。
 * 后端接口：POST /api/v1/track/events（已实现，见 docs/API.md「七、用户行为打点」）。
 * 完整约定见 docs/埋点打点方案.md。
 */
import { TrackEventType } from '../types/tracking'
import type { TrackEventDef } from '../types/tracking'

export const TRACKING_CONFIG = {
  /** 总开关：false 时 track() 直接丢弃（调试 / 灰度用，setTrackingEnabled 可运行时切换） */
  enabled: true,
  /** 上报接口路径 */
  apiPath: '/api/v1/track/events',
  /** 队列攒批阈值：达到即触发一次上报（后端单批上限 100，前端阈值留余量） */
  batchSize: 50,
  /** 定时上报间隔（毫秒），App.onLaunch 启动 */
  flushIntervalMs: 10_000,
  /** 队列上限：上报失败重试堆积超过上限时丢弃最旧事件（防内存无限增长） */
  maxQueue: 200,
  /** props / target 等字符串字段单值截断长度（防超长脏数据撑大请求体） */
  maxStringLen: 256,
  /** 搜索关键词截断长度（专项，见 TRACK_EVENT_DEFS['search.submit']） */
  keywordMaxLen: 32,
} as const

/** 字符串截断到上限（按字符截断，防脏数据撑大请求体） */
export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * 声明式事件定义表（事件清单的唯一来源，docs/埋点打点方案.md「二、事件命名规范」）。
 *
 * 调用方统一走 `trackEvent(key, params)`（utils/tracker.ts），key 即本表键名；
 * 事件名 / eventType / page / target / props 组装规则都只在这里声明一次，
 * 新增事件 = 本表加一行 + 调用处一行 trackEvent，无需再写辅助函数。
 *
 * params 规则（尽量少传参）：
 * - 传单个标量（string/number/boolean）：定义了 target 时作 target；否则作唯一 props 字段的值；
 * - 传对象：按 target / props 声明的字段名取；
 * - 不传：用于无需业务参数的事件（如 share.trigger / login.action）。
 */
export const TRACK_EVENT_DEFS: Record<string, TrackEventDef> = {
  // —— 页面 / 组件操作 ——
  /** 切换底部 Tab：trackEvent('tab.switch', 'finance') → target=finance */
  'tab.switch': { name: 'tab.switch', type: TrackEventType.Action, target: 'tab' },

  /** 提交搜索：trackEvent('search.submit', '茅台') → props.keyword；空白不埋，关键词截断 32 字 */
  'search.submit': {
    name: 'search.submit',
    type: TrackEventType.Action,
    required: ['keyword'],
    props: {
      keyword: (ctx) =>
        clip(String(ctx.params.keyword ?? '').trim(), TRACKING_CONFIG.keywordMaxLen),
    },
  },

  /** 点搜索结果：trackEvent('search.result_tap', '600519') → target=股票 code */
  'search.result_tap': { name: 'search.result_tap', type: TrackEventType.Tap, target: 'code' },

  /** 查看新闻详情：trackEvent('news.view', { id, title }) → props 带 id + 标题 */
  'news.view': {
    name: 'news.detail.view',
    type: TrackEventType.PageView,
    page: 'pages/news-detail/index',
    props: {
      id: (ctx) =>
        ctx.params.id !== undefined && ctx.params.id !== null ? String(ctx.params.id) : '',
      title: (ctx) => String(ctx.params.title ?? '').trim() || '未知新闻',
    },
  },

  /** 点行情卡片查看分时：trackEvent('card.tap', { code, name, minuteCode }) → target=code */
  'card.tap': {
    name: 'market.card_tap',
    type: TrackEventType.Tap,
    target: 'code',
    props: { code: 'code', name: 'name', minuteCode: 'minuteCode' },
  },

  /** 点「i」图标打开说明弹窗：trackEvent('tip.open', '金银') → props.section；空白不埋 */
  'tip.open': {
    name: 'info.tip_open',
    type: TrackEventType.Tap,
    props: {
      section: (ctx) => String(ctx.params.section ?? '').trim(),
    },
    required: ['section'],
  },

  /**
   * 触发分享：trackEvent('share.trigger') → props.source 自动取当前页路由；
   * 新闻详情页可带业务对象：trackEvent('share.trigger', { id, title }) → props 附新闻 id + 标题
   */
  'share.trigger': {
    name: 'share.trigger',
    type: TrackEventType.Action,
    props: {
      source: (ctx) => ctx.page,
      id: (ctx) =>
        ctx.params.id !== undefined && ctx.params.id !== null ? String(ctx.params.id) : '',
      title: (ctx) => String(ctx.params.title ?? '').trim(),
    },
  },

  /** 切主题：trackEvent('theme.switch', 'dark') → props.theme（system/light/dark） */
  'theme.switch': {
    name: 'theme.switch',
    type: TrackEventType.Action,
    props: { theme: 'theme' },
  },

  /** 登录成功：trackEvent('login.action') */
  'login.action': { name: 'login.action', type: TrackEventType.Action },
}
