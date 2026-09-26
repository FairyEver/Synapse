import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GeneratedPageCatalog } from './types.js'

/**
 * 加载 `generated/page-catalog.json`（1,019 行页面唯一参考清单，D24/D33）。
 *
 * 加载方式与 `src/context/module-type.ts` 保持一致：同步读 + 进程内缓存 + 测试注入口。
 * 为什么不用 `import ... from '../../generated/*.json'`：清单在 `tsconfig.build.json`
 * 的 `include`（只有 `src/**`）之外，静态导入会把它变成编译期类型的一部分，
 * 且构建产物里 generated/ 的位置不确定。运行时读文件两条路径都能覆盖。
 */

let cached: GeneratedPageCatalog | null = null

const EMPTY: GeneratedPageCatalog = {
  generatedAt: '',
  portalRepo: '',
  total: 0,
  items: [],
}

export function loadPageCatalog (): GeneratedPageCatalog {
  if (cached) return cached

  const here = dirname(fileURLToPath(import.meta.url))
  // 源码运行时（src/catalog）与构建产物（dist/catalog）都要能找到 generated/
  const candidates = [
    join(here, '../../generated/page-catalog.json'),
    join(here, '../../../generated/page-catalog.json'),
  ]

  for (const file of candidates) {
    try {
      const raw = readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<GeneratedPageCatalog>
      cached = {
        generatedAt: parsed.generatedAt ?? '',
        portalRepo: parsed.portalRepo ?? '',
        total: parsed.total ?? 0,
        items: Array.isArray(parsed.items) ? parsed.items : [],
      }
      return cached
    } catch {
      continue
    }
  }

  cached = EMPTY
  return cached
}

/** 仅测试用：注入清单，避免依赖 generated 产物 */
export function __setPageCatalogForTest (catalog: GeneratedPageCatalog | null): void {
  cached = catalog
}

/**
 * 从菜单路径推业务域。清单里的 `domain` 就是这么来的（菜单路径第二段）。
 * 能力定义的 `pagePath` 可能不在菜单树里（H36 的流程表单页），所以也要能算。
 */
export function domainOfPath (pagePath: string): string {
  const clean = pagePath.split('?')[0] ?? pagePath
  const segments = clean.split('/').filter((segment) => segment.length > 0)
  if (segments[0] === 'dashboard' && segments.length >= 2) {
    return segments[1] ?? '(unknown)'
  }
  return segments[0] ?? '(unknown)'
}
