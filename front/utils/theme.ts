import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { rootStore } from '../stores/root.store'
import { getTheme, type ThemeMode } from './storage'
import { syncWindowBackground } from './window'

export { getTheme, syncWindowBackground }
export type { ThemeMode }

type ThemeTarget = { setData: (data: Record<string, unknown>) => void }

const bindingMap = new WeakMap<object, { destroyStoreBindings: () => void }>()

/**
 * 页面 / 自定义组件绑定主题：基于全局 settings store（mobx-miniprogram-bindings），
 * 主题变更时自动刷新 this.data.theme（无需在 onShow 手动同步）。
 * onLoad / attached 调用一次即可，重复调用会先解绑旧绑定。
 */
export function bindTheme(target: ThemeTarget): void {
  bindingMap.get(target)?.destroyStoreBindings()
  const bindings = createStoreBindings(target, {
    store: rootStore.settings,
    fields: {
      theme: () => rootStore.settings.theme,
    },
    actions: {
      setTheme: 'setTheme',
    } as const,
  })
  bindingMap.set(target, bindings)
}

/** 页面 onUnload / 组件 detached 时调用，解除 store 绑定，避免内存泄漏 */
export function unbindTheme(target: object): void {
  bindingMap.get(target)?.destroyStoreBindings()
  bindingMap.delete(target)
}
