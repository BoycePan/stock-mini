// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { SITE_URL } from './src/config/site.ts'

// https://astro.build/config
export default defineConfig({
  // 纯静态站点（SSG）：构建产物 dist/ 可直接由 nginx 托管
  output: 'static',
  // site 复用 src/config/site.ts 的 SITE_URL（线上正式域名），canonical/sitemap/robots 随之生效
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [sitemap()],
})
