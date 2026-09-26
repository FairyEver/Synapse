/**
 * 把「页面唯一参考清单」+「已注册能力定义」合成一份可下钻的目录索引。
 *
 * 两边的对齐关系（设计 H8）：
 * - 清单侧是 1,019 行菜单页面（D24/D33），key 是 `menuPath`
 * - 能力侧是 `src/capabilities/*.ts` 里手写/生成的能力定义，key 是 `pagePath`
 * - 能力定义里出现的 `pagePath` **不一定在清单里**：流程表单页（H36 的 112 个
 *   `/simple/<模块>/form/<NNN>`、以及 `/dashboard/flow/form/edit`）根本不在菜单树里。
 *   这些页面按 `capability-only` 收进目录，不能丢——它们是真实可达的入口（从「发起流程」跳过来）。
 */

import type { CapabilityDefinition, ParamSpec } from '../capabilities/types.js'
import { DOMAIN_LABELS } from './aliases.js'
import { domainOfPath } from './page-catalog.js'
import type { CatalogCapability, CatalogPage, GeneratedPageRow } from './types.js'

export type DomainBucket = {
  domain: string
  label: string
  /** 该域的页面（含 capability-only） */
  pages: CatalogPage[]
  /** 该域下已注册的能力（同一能力可能同时属于多个域） */
  capabilities: CatalogCapability[]
}

export type CatalogIndex = {
  generatedAt: string
  /** 全部页面：菜单清单 + capability-only */
  pages: CatalogPage[]
  pageById: Map<string, CatalogPage>
  /** menuPath → 页面（capability-only 页也以此登记） */
  pageByPath: Map<string, CatalogPage>
  /** 按 ID 去重后的能力 */
  capabilities: CatalogCapability[]
  capabilityById: Map<string, CatalogCapability>
  domains: Map<string, DomainBucket>
  /** 同一 ID 出现多份定义的能力（数据问题，见 describe() 的 warnings） */
  duplicateCapabilityIds: string[]
  /** 能力定义引用了、但页面清单里没有的页面路径 */
  capabilityOnlyPagePaths: string[]
}

export type BuildIndexInput = {
  rows: GeneratedPageRow[]
  capabilities: CapabilityDefinition[]
  generatedAt?: string
}

/** capability-only 页面的 id 前缀，便于一眼看出来它不是清单里的行 */
export const CAPABILITY_PAGE_ID_PREFIX = 'capability-page:'

function makeCatalogPage (row: GeneratedPageRow, source: CatalogPage['source']): CatalogPage {
  return { ...row, source, capabilityIds: [] }
}

/**
 * 同一 ID 的多份定义合并成一条能力。
 *
 * 参数按名字合并，`required` 取**更严的一侧**（任一定义要求必填就算必填）——
 * 宁可让 AI 多传一个参数（两个入口都接受），也不要让它漏传一个（其中一个入口会失败）。
 */
function mergeCapabilities (definitions: CapabilityDefinition[]): CatalogCapability {
  const primary = definitions[0]
  if (primary === undefined) {
    throw new Error('mergeCapabilities 需要至少一份定义')
  }

  const paramOrder: string[] = []
  const paramByName = new Map<string, ParamSpec>()
  for (const definition of definitions) {
    for (const param of definition.params) {
      const existing = paramByName.get(param.name)
      if (existing === undefined) {
        paramOrder.push(param.name)
        paramByName.set(param.name, param)
        continue
      }
      paramByName.set(param.name, {
        ...existing,
        required: existing.required || param.required,
        ...(existing.description === undefined && param.description !== undefined
          ? { description: param.description }
          : {}),
        ...(existing.lookup === undefined && param.lookup !== undefined
          ? { lookup: param.lookup }
          : {}),
        ...(existing.options === undefined && param.options !== undefined
          ? { options: param.options }
          : {}),
      })
    }
  }

  const pagePaths: string[] = []
  for (const definition of definitions) {
    if (!pagePaths.includes(definition.pagePath)) pagePaths.push(definition.pagePath)
  }

  return {
    id: primary.id,
    title: primary.title,
    pagePaths,
    definitions,
    primary,
    write: definitions.some((definition) => definition.write),
    params: paramOrder.map((name) => paramByName.get(name)!),
    conflict: definitions.length > 1,
  }
}

export function buildIndex (input: BuildIndexInput): CatalogIndex {
  const pages: CatalogPage[] = input.rows.map((row) => makeCatalogPage(row, 'menu-catalog'))
  const pageById = new Map<string, CatalogPage>()
  const pageByPath = new Map<string, CatalogPage>()
  for (const page of pages) {
    pageById.set(page.id, page)
    if (page.menuPath !== null && page.menuPath.length > 0) pageByPath.set(page.menuPath, page)
  }

  const duplicateCapabilityIds: string[] = []
  const capabilityOnlyPagePaths: string[] = []
  const byId = new Map<string, CapabilityDefinition[]>()

  for (const definition of input.capabilities) {
    const existing = byId.get(definition.id)
    if (existing === undefined) {
      byId.set(definition.id, [definition])
    } else {
      existing.push(definition)
    }

    // 页面侧对齐：清单里有就挂上去，没有就补一个 capability-only 页
    if (!pageByPath.has(definition.pagePath)) {
      const path = definition.pagePath
      if (!capabilityOnlyPagePaths.includes(path)) capabilityOnlyPagePaths.push(path)
      const synthetic: CatalogPage = {
        id: `${CAPABILITY_PAGE_ID_PREFIX}${path}`,
        menuPath: path,
        title: path.split('/').filter((segment) => segment.length > 0).slice(-2).join('/'),
        domain: domainOfPath(path),
        permission: '',
        routeFile: null,
        kind: '能力页（不在菜单树）',
        write: null,
        menuSource: '',
        status: '',
        moduleType: null,
        moduleTypeLabel: '',
        source: 'capability-only',
        capabilityIds: [],
      }
      pages.push(synthetic)
      pageById.set(synthetic.id, synthetic)
      pageByPath.set(path, synthetic)
    }
  }

  const capabilities: CatalogCapability[] = []
  const capabilityById = new Map<string, CatalogCapability>()
  for (const [, definitions] of byId) {
    const merged = mergeCapabilities(definitions)
    if (merged.conflict) duplicateCapabilityIds.push(merged.id)
    capabilities.push(merged)
    capabilityById.set(merged.id, merged)
    for (const pagePath of merged.pagePaths) {
      const page = pageByPath.get(pagePath)
      if (page !== undefined && !page.capabilityIds.includes(merged.id)) {
        page.capabilityIds.push(merged.id)
      }
    }
  }

  // 域分桶：页面归域；能力跟着它的页面进域（可能同时进多个域）
  const domains = new Map<string, DomainBucket>()
  const bucketOf = (domain: string): DomainBucket => {
    const existing = domains.get(domain)
    if (existing !== undefined) return existing
    const created: DomainBucket = {
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      pages: [],
      capabilities: [],
    }
    domains.set(domain, created)
    return created
  }

  for (const page of pages) {
    bucketOf(page.domain).pages.push(page)
  }
  for (const capability of capabilities) {
    const seenDomains = new Set<string>()
    for (const pagePath of capability.pagePaths) {
      const page = pageByPath.get(pagePath)
      if (page === undefined) continue
      if (seenDomains.has(page.domain)) continue
      seenDomains.add(page.domain)
      bucketOf(page.domain).capabilities.push(capability)
    }
  }

  return {
    generatedAt: input.generatedAt ?? '',
    pages,
    pageById,
    pageByPath,
    capabilities,
    capabilityById,
    domains,
    duplicateCapabilityIds,
    capabilityOnlyPagePaths,
  }
}

/**
 * 目录文件名 `page-catalog.json` 的来源仓库与时间，用于诊断"版本对齐"（H37/H38）。
 */
export function describeIndexSource (index: CatalogIndex): string {
  return `page-catalog generatedAt=${index.generatedAt || '(unknown)'} pages=${index.pages.length} capabilities=${index.capabilities.length}`
}
