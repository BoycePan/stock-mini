import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { rootStore } from '../stores/root.store'

export type StoreBindingsHandle = {
  updateStoreBindings: () => void
  destroyStoreBindings: () => void
}

type BindingTarget = { setData: (data: Record<string, unknown>) => void }

const bindingRegistry = new WeakMap<object, StoreBindingsHandle>()

/**
 * 登记页面/组件在生命周期内创建的 store 绑定（可登记多个，后登记会先释放旧的），
 * 在 onUnload / detached 调用 releaseStoreBindings() 统一释放，避免内存泄漏。
 */
export function registerStoreBinding(target: object, handle: StoreBindingsHandle): void {
  releaseStoreBindings(target)
  bindingRegistry.set(target, handle)
}

export function releaseStoreBindings(target: object): void {
  bindingRegistry.get(target)?.destroyStoreBindings()
  bindingRegistry.delete(target)
}

/**
 * 把全局用户信息（登录态 / 用户资料）绑定到页面 data：
 * - data.user / data.isLoggedIn 随 auth store 自动同步（登录、登出即时刷新）
 * - 页面 this 下注入 logout action（等价 rootStore.auth.logout）
 */
export function bindGlobalAuth(target: BindingTarget): StoreBindingsHandle {
  return createStoreBindings(target, {
    store: rootStore.auth,
    fields: {
      user: () => rootStore.auth.user,
      isLoggedIn: () => rootStore.auth.isLoggedIn,
    },
    actions: {
      logout: 'logout',
    } as const,
  })
}
