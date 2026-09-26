#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境跑一遍**图库管理**的完整写链路。
 *
 * ⚠️ 这是写操作——会真的建出图库记录（`SDK-TEST-` 前缀），跑完立刻删掉并再查一次证实。
 * 只有在明确授权后才运行（用户 2026-09-20 对测试环境的授权，见 docs/conventions.md 第 8 条）。
 *
 * 跑法：
 *   smoke/with-portal-token.sh node smoke/base-image-crud.mjs
 *
 * 需要环境变量（由 with-portal-token.sh 注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 * 可选：
 *   PORTAL_SMOKE_KEEP=1   跑完不删（排查用；别长期留着）
 *
 * ## 为什么这个脚本是「包一层 vitest」
 *
 * SDK 是 TypeScript。裸 Node 跑不了 `src/*.ts`：开启类型剥离后 `import './x.js'`
 * **不会**回退去找 `./x.ts`（实测 ERR_MODULE_NOT_FOUND），而 `pnpm build` 在这个
 * 并行窗口里不能跑（会与别的任务抢 `dist/`）。vitest 本来就是本包的测试跑者，
 * 把类型解析这件事包了，而且 `with-portal-token.sh` 的注释里也给了同样的用法例子。
 *
 * 于是分工是：
 * - **写链路的真机验证**在 `test/base-image.test.ts` 的 `LIVE 真实环境` 一组里
 *   （只有这三个环境变量都在时才跑；平时 `pnpm test` 是 skipped，不碰网络）。
 *   它按 `src/index.ts` 的三行手动接线，跑的是**真实 SDK 请求层**。
 * - 这一层只负责：确认环境变量在 → 起 vitest → 把退出码原样传出去。
 *
 * 真实环境的结论逐条记在 `docs/pages/图库管理.md` 的「真实验证记录」。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const missing = ['PORTAL_BASE_URL', 'PORTAL_TOKEN', 'PORTAL_TENANT_ID'].filter(
  (name) => !process.env[name],
)
if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}（用 smoke/with-portal-token.sh 包一层）\n`,
  )
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

process.stdout.write(`环境：${process.env.PORTAL_BASE_URL}（租户 ${process.env.PORTAL_TENANT_ID}）\n`)
process.stdout.write('跑 test/base-image.test.ts（含 LIVE 真机组：建 → 两次独立复核 → 改 → 删）\n\n')

const child = spawn('pnpm', ['exec', 'vitest', 'run', 'test/base-image.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  process.stderr.write(`起 vitest 失败：${error.message}\n`)
  process.exit(1)
})
