/**
 * 自检：人工维护的数据表（aliases.ts / links.ts）与能力定义里的 `lookup`
 * 是不是指向了真实存在的东西。
 *
 * 为什么需要它：别名表和链路表是**人写的**，写错一个路径不会有任何运行时症状——
 * 只是"这条推荐永远推不出来"。死链必须能被自动化测试抓住，
 * 所以这里的函数返回问题列表，`test/catalog.test.ts` 断言它为空。
 */

import { ALIAS_ENTRIES, type AliasTarget } from './aliases.js'
import type { CatalogIndex } from './catalog-index.js'
import { CAPABILITY_LINKS } from './links.js'

export type AliasIssue = {
  entryId: string
  target: AliasTarget
  reason: string
}

export type LinkIssue = {
  from: string
  to: string
  reason: string
}

export type LookupIssue = {
  /** 声明 lookup 的那个能力 */
  capabilityId: string
  /** 声明 lookup 的参数 */
  paramName: string
  reason: string
}

/**
 * 校验能力定义里 `lookup` 声明的候选入口能不能真的用（G2）。
 *
 * 为什么必须有：`describe()` 会把 lookup 渲染成"候选入口已登记：xxx（用 yyy 作关键字查）"，
 * 并据此生成一条 `next` 边。`capabilityId` 写错、或 `keywordParam` 不是对方真有的参数，
 * 都不会有运行时症状——只是那条引导永远走不通，调用方按它传参会被后端拒。
 * 长选项参数是"用户给不出、必须查"的那一类，走不通就是整条链断在这里。
 */
export function validateLookups (index: CatalogIndex): LookupIssue[] {
  const issues: LookupIssue[] = []
  for (const capability of index.capabilities.values()) {
    for (const param of capability.params) {
      const lookup = param.lookup
      if (lookup === undefined) continue
      const target = index.capabilityById.get(lookup.capabilityId)
      if (target === undefined) {
        issues.push({
          capabilityId: capability.id,
          paramName: param.name,
          reason: `候选入口能力「${lookup.capabilityId}」不在目录里`,
        })
        continue
      }
      if (!target.params.some((candidate) => candidate.name === lookup.keywordParam)) {
        issues.push({
          capabilityId: capability.id,
          paramName: param.name,
          reason:
            `候选入口「${target.id}」没有名为「${lookup.keywordParam}」的参数` +
            `（它有：${target.params.map((candidate) => candidate.name).join('、') || '（无）'}）`,
        })
      }
    }
  }
  return issues
}

/** 校验别名表的每一个落点都能在真实目录里解析到 */
export function validateAliases (index: CatalogIndex): AliasIssue[] {
  const issues: AliasIssue[] = []
  const seenEntries = new Set<string>()

  for (const entry of ALIAS_ENTRIES) {
    if (seenEntries.has(entry.id)) {
      issues.push({ entryId: entry.id, target: { type: 'domain', id: '' }, reason: 'alias entry id 重复' })
    }
    seenEntries.add(entry.id)

    if (entry.phrases.length === 0) {
      issues.push({ entryId: entry.id, target: { type: 'domain', id: '' }, reason: 'phrases 为空，这个条目永远不会命中' })
    }
    if (entry.targets.length === 0) {
      issues.push({ entryId: entry.id, target: { type: 'domain', id: '' }, reason: 'targets 为空，命中也没有落点' })
    }

    for (const target of entry.targets) {
      if (target.type === 'capability') {
        if (!index.capabilityById.has(target.id)) {
          issues.push({ entryId: entry.id, target, reason: `能力「${target.id}」不在目录里` })
        }
        continue
      }
      if (target.type === 'page') {
        if (!index.pageByPath.has(target.menuPath)) {
          issues.push({ entryId: entry.id, target, reason: `页面「${target.menuPath}」不在页面清单里` })
        }
        continue
      }
      if (!index.domains.has(target.id)) {
        issues.push({ entryId: entry.id, target, reason: `业务域「${target.id}」不在目录里` })
      }
    }
  }

  return issues
}

/** 校验能力链路表的两端都是真实能力 */
export function validateLinks (index: CatalogIndex): LinkIssue[] {
  const issues: LinkIssue[] = []
  for (const link of CAPABILITY_LINKS) {
    if (!index.capabilityById.has(link.from)) {
      issues.push({ from: link.from, to: link.to, reason: `上游能力「${link.from}」不在目录里` })
    }
    if (!index.capabilityById.has(link.to)) {
      issues.push({ from: link.from, to: link.to, reason: `下游能力「${link.to}」不在目录里` })
    }
    if (link.from === link.to) {
      issues.push({ from: link.from, to: link.to, reason: '上下游是同一个能力，链路没有意义' })
    }
  }
  return issues
}
