#!/usr/bin/env node
/**
 * 漂移门禁：生成物必须与提交进仓库的那份一致。
 *
 * 这是 OpenAPI 最佳实践里反复出现的一条——**防止文档与代码悄悄分叉**：
 * 生成 → 比对 → 有差异就让构建失败。
 *
 * 覆盖的生成物：
 *   generated/page-catalog.json        页面清单
 *   generated/module-type-rules.json   module-type 规则
 *   generated/openapi.json             OpenAPI 规格
 *   generated/coverage.md              覆盖与进度报告（含提交号，所以它天然会比出差异——
 *                                      这一项只在 CI 或显式要求时检查）
 *
 * 用法：
 *   pnpm docs:drift            本地检查（报告里的提交号那项会被忽略）
 *   pnpm docs:drift --strict   CI 用，连报告也一起比
 *
 * 为什么默认忽略报告：报告里写了生成时的 commit，任何一次提交都会让它变，
 * 把它当门禁会导致每次提交都要重新生成——那是噪音，不是保护。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const strict = process.argv.includes('--strict')

const CHECKED = [
  'generated/page-catalog.json',
  'generated/module-type-rules.json',
  'generated/openapi.json',
  'generated/scope-audit.json',
  ...(strict ? ['generated/coverage.md'] : []),
]

function git (args) {
  return execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

// 仓库必须是干净的参考点，否则"有差异"这件事分不清是漂移还是你正在改别的东西
let tracked
try {
  tracked = git(['ls-files', '--error-unmatch', 'generated/page-catalog.json']).trim()
} catch {
  tracked = ''
}
if (!tracked) {
  process.stdout.write('[drift] generated/ 还没入库（首次生成），跳过比对\n')
  process.exit(0)
}

const drifted = []
const missing = []

/**
 * 归一化掉"每次生成都不同、但语义没变"的字段。
 *
 * 不这么做的话这个门禁毫无价值：生成物里带 generatedAt 时间戳，
 * 每次重新生成都会被判为漂移，门禁永远红——那是噪音，不是保护。
 * （这个缺陷是第一次跑门禁时被它自己抓出来的。）
 */
const VOLATILE_KEYS = ['generatedAt']

function normalize (rel, content) {
  if (!rel.endsWith('.json')) return content
  try {
    const obj = JSON.parse(content)
    for (const key of VOLATILE_KEYS) delete obj[key]
    return JSON.stringify(obj)
  } catch {
    return content
  }
}

for (const rel of CHECKED) {
  const abs = path.join(PKG_ROOT, rel)
  if (!fs.existsSync(abs)) {
    missing.push(rel)
    continue
  }
  // 与 HEAD 里的版本比，而不是与工作区比——工作区就是刚生成的那份
  let headContent
  try {
    headContent = git(['show', `HEAD:${rel}`])
  } catch {
    missing.push(`${rel}（不在 HEAD 里）`)
    continue
  }
  if (normalize(rel, headContent) !== normalize(rel, fs.readFileSync(abs, 'utf8'))) {
    drifted.push(rel)
  }
}

if (missing.length) {
  process.stderr.write(`[drift] 以下生成物在 HEAD 中不存在：\n  ${missing.join('\n  ')}\n`)
}

if (drifted.length) {
  process.stderr.write(
    `[drift] 以下生成物与 HEAD 不一致：\n  ${drifted.join('\n  ')}\n\n` +
      '这通常意味着改了能力定义 / 生成器之后没有重新生成。\n' +
      '修法：跑 `pnpm build && pnpm generate && pnpm openapi`，然后把生成物一起提交。\n',
  )
  process.exit(1)
}
if (missing.length) process.exit(1)

process.stdout.write(`[drift] ${CHECKED.length} 项生成物与 HEAD 一致\n`)
