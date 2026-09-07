/**
 * robots.txt（SSG 动态生成）：sitemap 地址由 SITE_URL 推导，
 * 替换真实域名后无需再手工同步本文件（旧静态版位于 public/robots.txt，已移除）。
 */
import { SITE_URL } from '../config/site'

export function GET() {
  const body = [
    '# 市场追踪助手门户网站 robots.txt',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    '',
  ].join('\n')
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
