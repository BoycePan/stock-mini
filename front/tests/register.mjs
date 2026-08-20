/**
 * Node 测试运行器专用入口：注册「无后缀本地 TS import」解析 loader。
 *
 * 背景：微信开发者工具编译 TS 时要求 import 不带 `.ts` 后缀（带后缀会报
 * `module 'xxx.ts.js' is not defined`），而 Node 的 strip-types 又不解析无后缀的相对路径，
 * 两者冲突。本 loader 仅在测试进程内把 `./foo` / `../foo` 解析为 `./foo.ts`，运行时代码保持无后缀。
 */
import { register } from 'node:module'

register('./ts-resolve-loader.mjs', import.meta.url)
