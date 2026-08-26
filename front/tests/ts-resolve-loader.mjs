/**
 * Node ESM resolve loader：把无后缀的相对路径 import 依次尝试 `.ts` / `.tsx` / `/index.ts`。
 * 仅影响测试进程；微信开发者工具编译走自己的 TS 插件，不经过本 loader。
 *
 * 注意：只把「已知扩展名」视为扩展名。点分文件名（如 env.development / env.production）
 * 会被 `/\.[a-z0-9]+$/` 误判为带扩展名而跳过 .ts 候选解析，这里必须用白名单判定。
 */
const KNOWN_EXT_RE = /\.(ts|tsx|js|mjs|cjs|json)$/i

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (isRelative && !KNOWN_EXT_RE.test(specifier)) {
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
