/**
 * 把 `src/context/http-instance.ts` 的实例推导器借给 `tools/` 下的纯 Node 脚本用。
 *
 * **这不是第二份推导器。** 18 个实例的画像（baseURL、补不补 `/admin-api`、分页参数名、
 * 请求头）、以及「哪一页走哪个实例」的解析优先级（请求级声明 → 页面规则 → 全局默认），
 * 全都只在 `src/context/http-instance.ts` 里。本文件只负责**把它加载进来**：
 * 两份推导器迟早会给出不同的答案，而这一次答案是 URL——猜错的后果不是少一个头，
 * 是静默打到别的后端。
 *
 * 加载顺序（越靠前越新，前一档能用就绝不往后走）：
 *
 * 1. **直接 import 那份 TypeScript 源码**（Node ≥ 22.15 的 `module.registerHooks`
 *    + 默认开启的类型擦除）。这是唯一"永远最新"的一档——推导器改一个字就立刻生效。
 *    源码内部写的是 `import ... from './module-type.js'`（TypeScript 的 bundler 解析），
 *    Node 不做 `.js` → `.ts` 的映射，所以这里挂一个 resolve 钩子补上这一步。
 * 2. **退到 `dist/context/http-instance.js`**（先跑过 `pnpm build`）。dist 是**产物**，
 *    可能比源码旧；用一个显式的过期判据卡住——过期就报错，而不是安静地给出旧答案。
 * 3. 两档都不行 → 抛错。**失败关闭**：算不出实例就不产能力定义。
 *    这条口径与 `src/context/http-instance.ts` 自己一致（宁可拒绝，不猜）。
 */

import fs from 'node:fs'
import nodeModule from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')

const SRC_ENTRY = path.join(PKG_ROOT, 'src/context/http-instance.ts')
const SRC_URL_PREFIX = pathToFileURL(path.join(PKG_ROOT, 'src')).href + '/'
/** 推导器依赖的源码：它们任一改动都会让 dist 那一档过期 */
const SRC_DEPS = [path.join(PKG_ROOT, 'src/context/module-type.ts')]
const DIST_ENTRY = path.join(PKG_ROOT, 'dist/context/http-instance.js')

/**
 * 第一档：直接读 TypeScript 源码。
 * `registerHooks` 与类型擦除缺一样就返回 null 走下一档——不猜、不假装能跑。
 *
 * 钩子只补**源码目录内部**那一步 `.js` → `.ts`（TypeScript 的 bundler 解析要求
 * 相对导入写 `.js`，Node 不做这个映射）；`node:`、第三方包一律不碰。
 */
function registerHooksOnce () {
  const registerHooks = nodeModule.registerHooks
  if (typeof registerHooks !== 'function') return false
  registerHooks({
    resolve (specifier, context, nextResolve) {
      if (specifier.endsWith('.js') && (context.parentURL ?? '').startsWith(SRC_URL_PREFIX)) {
        const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
        if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
      return nextResolve(specifier, context)
    },
  })
  return true
}

async function loadFromSource () {
  if (!registerHooksOnce()) return null
  if (!fs.existsSync(SRC_ENTRY)) return null
  if (!SRC_DEPS.every((file) => fs.existsSync(file))) return null
  return import(pathToFileURL(SRC_ENTRY).href)
}

/**
 * 按绝对路径 import `src/` 下的 TypeScript 模块（同一套加载策略，失败关闭）。
 * 给 `tools/` 下需要直接验生成物行为的自检脚本用——生成物是 TypeScript，
 * 而 `dist/` 可能过期（见上面第二档的判据）。
 */
export async function loadSourceModule (absPath) {
  if (!path.isAbsolute(absPath)) throw new Error(`loadSourceModule 需要绝对路径：${absPath}`)
  if (!registerHooksOnce() || !fs.existsSync(absPath)) {
    throw new Error(
      `[http-instance] 载入不了 ${absPath}：需要 Node ≥ 22.15 的 TS 直读能力（module.registerHooks）。`,
    )
  }
  return import(pathToFileURL(absPath).href)
}

/** 第二档：退到构建产物，但过期就拒绝，不给出旧答案 */
async function loadFromDist () {
  if (!fs.existsSync(DIST_ENTRY)) return null
  const newestSource = Math.max(
    ...[SRC_ENTRY, ...SRC_DEPS].filter((file) => fs.existsSync(file))
      .map((file) => fs.statSync(file).mtimeMs),
  )
  if (fs.statSync(DIST_ENTRY).mtimeMs < newestSource) {
    throw new Error(
      `[http-instance] dist/context/http-instance.js 比 src/ 的推导器旧，拒绝用它（差值会变成错的 URL）。\n` +
      '  修法：pnpm build（或者用 Node ≥ 22.15 跑，那样会直接读源码，不需要构建）',
    )
  }
  return import(pathToFileURL(DIST_ENTRY).href)
}

let cached = null

/**
 * 载入实例推导器。返回 `src/context/http-instance.ts` 的导出集合，
 * 至少要包含 `resolveHttpInstance` / `applyUrlRewrite` / `DEFAULT_HTTP_INSTANCE_ID`。
 */
export async function loadHttpInstanceResolver () {
  if (cached) return cached
  const loaded = (await loadFromSource()) ?? (await loadFromDist())
  if (!loaded) {
    throw new Error(
      '[http-instance] 载入不了实例推导器：既读不到 src（需要 Node ≥ 22.15 的 TS 直读），' +
      '也没有可用的 dist/context/http-instance.js。\n  修法：pnpm build，或换成 Node ≥ 22.15。',
    )
  }
  cached = loaded
  return loaded
}
