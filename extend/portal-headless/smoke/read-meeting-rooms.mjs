#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次会议室列表。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 先构建：pnpm build
 * 再运行：PORTAL_BASE_URL=... PORTAL_TOKEN=... PORTAL_TENANT_ID=... pnpm smoke:meeting-room
 *
 * 只做读操作，不写任何数据。
 */
import { createPortalHeadless } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：\n' +
      '  PORTAL_BASE_URL=https://biz-api-test.wodecorp.cn \\\n' +
      '  PORTAL_TOKEN=<会话 token> \\\n' +
      '  PORTAL_TENANT_ID=<租户 id> \\\n' +
      '  pnpm smoke:meeting-room\n',
  )
  process.exit(1)
}

const PAGE = '/dashboard/meeting-room/list'

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
})

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType === null ? '（无规则匹配，与浏览器一致：不发这个头）' : `${resolved.moduleType} ${resolved.label}`}\n`,
)

try {
  const page = await sdk.meetingRoom.list({ pageNo: 1, pageSize: 5 })
  process.stdout.write(`\n会议室共 ${page.total} 条，前 ${page.list.length} 条：\n`)
  for (const room of page.list) {
    process.stdout.write(`  #${room.id} ${room.name}\n`)
  }
} catch (error) {
  process.stderr.write(`\n调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}
