// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { SITE_URL } from './src/config/site.ts'

// https://astro.build/config
export default defineConfig({
  // 纯静态站点（SSG）：构建产物 dist/ 可直接由 nginx 托管
  output: 'static',
  // ⚠️ 上线前替换为真实域名（如 https://market.guyuinfo.com），并同步 src/config/site.ts
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [sitemap()],
})
