#!/usr/bin/env node
/**
 * 冒烟（**只读**）：验证「同 host 不同前缀」的四个网关在测试环境里到底怎么走。
 *
 * 背景：`docs/base-capabilities.md` 的 P0-0 说 `src/context/http-instance.ts` 的
 * platform 透传白名单「漏了 `/admin-shop-api` 与 `/admin-crm-api`」，不修就会静默打到
 * `/admin-api/admin-shop-api/...`。这个脚本把两边的真实状态各打一次，让结论有据可查：
 *
 *   A 组（怕的 URL）：`{base}/admin-api/admin-shop-api/...`、`{base}/admin-api/admin-crm-api/...`
 *   B 组（对的 URL）：`{base}/admin-shop-api/...`、`{base}/admin-crm-api/...`
 *
 * 判据来自 Portal 前端：`sale.js` / `crm.js` 各自是**独立的 axios 实例、各自带 baseURL**
 * （`VITE_SHOP_ADMIN_API` / `VITE_CRM_API`），它们的路径里**不带**网关前缀；
 * 而 `platform.js:18-20` 的透传清单原文就是三个前缀（`/admin-api` / `/adminmanage-api`
 * / `/mall-manage-api`）。所以 A 组的 URL 在浏览器里根本不会产生。
 *
 * **判据是包络里的 `ret`，不是 HTTP 状态码**（2026-09-20 实测）：打错前缀时后端照样回
 * HTTP 200，只有包络里是 `{code:404, ret:"FAIL", msg:"请求资源不存在:..."}`。
 * 这正是这种错误"静默"的原因——光看状态码发现不了。
 *
 * 用法（凭据只在环境变量里，不落盘、不打印）：
 *   ./smoke/with-portal-token.sh node smoke/read-http-instance-prefix.mjs
 *
 * 只做 GET，不写任何数据。
 */
const baseUrl = (process.env.PORTAL_BASE_URL ?? '').replace(/\/+$/, '')
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：./smoke/with-portal-token.sh node smoke/read-http-instance-prefix.mjs\n',
  )
  process.exit(1)
}

/** 与 `src/http/client.ts` 的 buildHeaders 同构：token / tenant-id / Accept-Language */
const HEADERS = {
  'tenant-id': String(tenantId),
  token: String(token),
  'Accept-Language': 'zh-CN',
}

const CASES = [
  { note: 'A 怕的 URL（platform 前缀 + 网关前缀叠一起）', url: '/admin-api/admin-shop-api/admin/shop/getInfo' },
  { note: 'A 怕的 URL（crm 版）', url: '/admin-api/admin-crm-api/vue/getUserInfo' },
  { note: 'B 对的 URL（sale.js 的 baseURL + 它的路径）', url: '/admin-shop-api/admin/shop/getInfo' },
  { note: 'B 对的 URL（crm.js 的 baseURL + 它的路径）', url: '/admin-crm-api/vue/getUserInfo' },
]

let bad = 0
for (const item of CASES) {
  const target = `${baseUrl}${item.url}`
  let status = 0
  let body = ''
  let ret = '(解析不出)'
  try {
    const response = await fetch(target, { method: 'GET', headers: HEADERS })
    status = response.status
    const text = await response.text()
    // 先解析全文再截断显示：截断后的 JSON 解析不出来，会把四条全判成"没到达"
    body = text.slice(0, 200).replace(/\s+/g, ' ')
    try {
      ret = String(JSON.parse(text).ret ?? '(无 ret)')
    } catch {
      ret = '(不是 JSON)'
    }
  } catch (error) {
    body = `请求失败：${error instanceof Error ? error.message : String(error)}`
    ret = '(请求失败)'
  }
  const isFeared = item.note.startsWith('A')
  // 到达 = 包络 ret === 'SUCCESS'。HTTP 200 不算数：打错前缀时它也是 200。
  const reached = status === 200 && ret === 'SUCCESS'
  if (isFeared && reached) bad += 1
  if (!isFeared && !reached) bad += 1
  process.stdout.write(
    `${reached ? '到达  ' : '没到达'}  HTTP ${status} ret=${ret}  ${item.note}\n     ${target}\n     ${body}\n`,
  )
}

process.stdout.write(
  bad === 0
    ? '\n结论：A 组（补错前缀的 URL）没到达，B 组（各实例自己的 baseURL）到达 —— 与「透传白名单漏了两个前缀导致打错」的说法不符：\n' +
        '      错的 URL 确实打不通（且是 HTTP 200 + ret=FAIL 的静默形态），但正确的那条路**不经过透传**，\n' +
        '      它是 sale.js / crm.js 各自的 baseURL（VITE_SHOP_ADMIN_API / VITE_CRM_API），SDK 已经这么建模。\n'
    : `\n结论：有 ${bad} 条与预期不符，需要重新看。\n`,
)

process.exit(bad === 0 ? 0 : 1)
