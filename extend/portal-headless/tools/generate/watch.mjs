#!/usr/bin/env node
/**
 * 看门狗：改动一落地就重新生成覆盖报告。
 *
 *   pnpm report:watch
 *
 * 它**不刷新浏览器**——报告是静态文件，按 ⌘R 看新的。页面头部写了生成时间，
 * 你随时知道看的是哪一版。
 *
 * 监控范围刻意收窄，避免自激（生成物写回被监控的目录 → 触发生成 → 无限循环）：
 *   src 目录下的全部 .ts       能力定义、目录、会话等
 *   docs/roadmap.json          路线图
 *   generated/page-catalog.json   你手动跑过 pnpm generate 之后，
 *                                 报告要跟着刷新（这个文件是 generate 的产物，
 *                                 不监控 generated/ 整目录就是为了不打架）
 *
 * 注意：本注释里不能出现形如 `星号星号斜杠` 的 glob 写法——
 * 那三个字符会被当成块注释的结束符，把后面的代码直接变成语法错误。
 * （这个坑第一次跑这个脚本时踩到了。）
 *
 * 不监控 Portal 仓库（CodeReview_Projects_Js）——那是另一个仓，改动频率低，
 * 真要更新清单请手动跑 `pnpm generate`。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')

const DEBOUNCE_MS = 400

/** 每轮重新生成要跑什么。build 必须在最前，因为 openapi/report 读的是 dist/ */
const PIPELINE = [
  ['pnpm', ['build']],
  ['pnpm', ['openapi']],
  ['pnpm', ['report']],
]

const WATCH_TARGETS = [
  path.join(PKG_ROOT, 'src'),
  path.join(PKG_ROOT, 'docs/roadmap.json'),
  path.join(PKG_ROOT, 'generated/page-catalog.json'),
]

let timer = null
let running = false
let queued = false

function stamp () {
  return new Date().toTimeString().slice(0, 8)
}

function changedPath (filename) {
  return filename ? path.relative(PKG_ROOT, path.join(PKG_ROOT, filename)) : '(未知)'
}

function runPipeline (reason) {
  if (running) {
    queued = true
    return
  }
  running = true
  process.stdout.write(`\n[watch] ${stamp()} 检测到改动：${reason}\n`)

  let failed = null
  for (const [cmd, args] of PIPELINE) {
    const result = spawnSync(cmd, args, { cwd: PKG_ROOT, stdio: 'inherit', shell: false })
    if (result.status !== 0) {
      failed = `${cmd} ${args.join(' ')}`
      break
    }
  }

  if (failed) {
    // 生成失败不该让看门狗退出——你正在改的代码就是半成品，
    // 停下等你修完再存一次更符合使用习惯。
    process.stdout.write(`[watch] ${stamp()} ✗ ${failed} 失败，等下次改动重试\n`)
  } else {
    process.stdout.write(`[watch] ${stamp()} ✓ 报告已更新 → generated/coverage.html（浏览器里按 ⌘R）\n`)
  }

  running = false
  if (queued) {
    queued = false
    runPipeline('（排队中的改动）')
  }
}

function schedule (reason) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    runPipeline(reason)
  }, DEBOUNCE_MS)
}

process.stdout.write(
  `[watch] 监控中（改动后重跑 build → openapi → report）：\n` +
    WATCH_TARGETS.map((p) => `[watch]   ${path.relative(PKG_ROOT, p)}`).join('\n') +
    `\n[watch] Ctrl+C 退出。浏览器不会自动刷新，改完按 ⌘R。\n`,
)

// 先跑一轮，保证打开时看到的就是最新的
runPipeline('（启动时先跑一轮）')

for (const target of WATCH_TARGETS) {
  if (!fs.existsSync(target)) {
    process.stdout.write(`[watch] 跳过不存在的目标：${path.relative(PKG_ROOT, target)}\n`)
    continue
  }
  const isDir = fs.statSync(target).isDirectory()
  try {
    fs.watch(target, { recursive: isDir }, (_event, filename) => {
      // 忽略编辑器写的临时文件，否则保存一次会触发好几轮
      const name = String(filename ?? '')
      if (!name || name.endsWith('~') || name.endsWith('.swp') || name.includes('.DS_Store')) return
      if (name.endsWith('.map') || name.endsWith('.d.ts')) return
      schedule(changedPath(filename))
    })
  } catch (error) {
    process.stderr.write(`[watch] 无法监控 ${target}：${error.message}\n`)
  }
}
