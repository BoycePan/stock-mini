/**
 * Node ESM resolve loader：把无后缀的相对路径 import 依次尝试 `.ts` / `.tsx` / `/index.ts`。
 * 仅影响测试进程；微信开发者工具编译走自己的 TS 插件，不经过本 loader。
 */
const EXTENSION_RE = /\.[a-z0-9]+$/i

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (isRelative && !EXTENSION_RE.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context)
      } catch {
        // 该候选不存在，继续尝试下一个
      }
    }
  }
  return nextResolve(specifier, context)
}
