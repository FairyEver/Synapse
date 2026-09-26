import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 复刻 Portal 前端的 getCurrentModuleType()（app/portal/menus/index.js:533-545）。
 *
 * 前端原本从 window.location.href 推导；无头下没有 URL，所以由调用方给出
 * 「目标页面路径」，这里做同样的映射（设计 H2 / D14）。
 *
 * 规则表不手写：由 tools/generate 从 Portal 源码的 all_menus_type_match 抽取，
 * 生成到 generated/module-type-rules.json，构建时烘入（设计 D13 / D18）。
 *
 * 一个实测事实（设计 §1d）：约 42% 的页面在浏览器里本来就算不出 module-type，
 * 前端此时返回 undefined、请求不带这个头。SDK 默认保持同样行为（设计 D34）。
 */

export type ModuleTypeRule = {
  type: number
  label: string
  kind: 'prefix'
  prefixes: string[]
} | {
  type: number
  label: string
  kind: 'paths'
  paths: string[]
}

export type ModuleTypeRuleTable = {
  generatedAt: string
  source: string
  rules: ModuleTypeRule[]
}

export type ModuleTypeResolution = {
  /** 传给后端的 module-type 值；null 表示"与浏览器一致，不发这个头" */
  moduleType: number | null
  label: string | null
  /** 命中依据，便于诊断 */
  matchedBy: 'rule' | 'none'
}

let cachedTable: ModuleTypeRuleTable | null = null

export function loadModuleTypeRules (): ModuleTypeRuleTable {
  if (cachedTable) return cachedTable

  const here = dirname(fileURLToPath(import.meta.url))
  // 源码运行时（src/context）与构建产物（dist/context）都要能找到 generated/
  const candidates = [
    join(here, '../../generated/module-type-rules.json'),
    join(here, '../../../generated/module-type-rules.json'),
  ]

  for (const file of candidates) {
    try {
      const raw = readFileSync(file, 'utf8')
      cachedTable = JSON.parse(raw) as ModuleTypeRuleTable
      return cachedTable
    } catch {
      continue
    }
  }

  cachedTable = { generatedAt: '', source: '', rules: [] }
  return cachedTable
}

/** 仅测试用：注入规则表，避免依赖 generated 产物 */
export function __setModuleTypeRulesForTest (table: ModuleTypeRuleTable | null): void {
  cachedTable = table
}

export function resolveModuleType (pagePath: string): ModuleTypeResolution {
  const menuEntryPath = normalizeMenuEntryPath(pagePath)
  const { rules } = loadModuleTypeRules()

  for (const rule of rules) {
    if (rule.kind === 'prefix') {
      if (rule.prefixes.some((prefix) => menuEntryPath.startsWith(prefix))) {
        return { moduleType: rule.type, label: rule.label, matchedBy: 'rule' }
      }
      continue
    }
    if (rule.paths.includes(menuEntryPath)) {
      return { moduleType: rule.type, label: rule.label, matchedBy: 'rule' }
    }
  }

  return { moduleType: null, label: null, matchedBy: 'none' }
}

/**
 * 复刻前端的菜单路径归并（app/portal/utils/router/menu.js:4-22）：
 * 详情/编辑/新建等页面归回它所属的列表页，再去匹配 module-type。
 */
const DETAIL_KEYWORDS = ['create', 'edit', 'data', 'detail', 'change', 'step1', 'step2', 'step3']

export function normalizeMenuEntryPath (path: string): string {
  const clean = path.split('?')[0] ?? ''
  if (clean.endsWith('/list')) return clean

  const segments = clean.split('/')
  const index = segments.findIndex((segment) => DETAIL_KEYWORDS.includes(segment))
  if (index > -1) {
    return [...segments.slice(0, index), 'list'].join('/')
  }
  return clean
}
