#!/usr/bin/env node
/**
 * 保留菜单的逐页静态审计。
 *
 * 这不是业务完成率生成器：静态源码只能提供动作线索，不能替代浏览器基准或真实
 * 写入回查。它的职责是把「菜单 -> 页面源码 -> 动作线索/支撑接口 -> capability /
 * AI 契约 / 文档 / 测试」固定成可 diff 的矩阵，并在新增菜单或删除接线时失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PORTAL_REPO = path.resolve(process.env.PORTAL_REPO || '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js')
const JAVA_REPO = path.resolve(process.env.JAVA_REPO || '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java')
const SCOPE_FILE = path.join(ROOT, 'generated/portal-scope.json')
const CATALOG_FILE = path.join(ROOT, 'generated/page-catalog.json')
const DIST_FILE = path.join(ROOT, 'dist/index.js')
const BUILD_MANIFEST_FILE = path.join(ROOT, 'dist/.source-content-hash.json')
const SRC_DIRECTORY = path.join(ROOT, 'src')
const OUTPUT_FILE = path.join(ROOT, 'generated/scope-audit.json')
const DOC_FILE = path.join(ROOT, 'docs/scope-audit.md')
const DEPENDENCY_ONLY_PAGE_PATHS = new Set([
  // 流程表单/办理页由人力保留菜单触发，但不是独立菜单叶子；不能当作范围外业务入口。
  '/dashboard/flow/form/edit',
  '/dashboard/flow/form/detail',
  '/dashboard/backlog/task-examine/batch-process',
  // 生产设置下的列表“查看方法/查看标准”进入隐藏子页；它们属于保留菜单的可达能力，
  // 但 Portal 菜单树没有独立叶子，不能误报为范围外 dashboard capability。
  '/dashboard/product/setting/hatch-manage/method-lib/indicator/list',
  '/dashboard/product/setting/hatchery-manage/method-lib/indicator/list',
  '/dashboard/product/setting/hatch-manage/lib/indicator/list',
  '/dashboard/product/setting/hatchery-manage/lib/indicator/list',
])

const hash = (value) => createHash('sha256').update(value).digest('hex')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')

function contentHash (files, root) {
  const digest = createHash('sha256')
  for (const file of files.slice().sort()) {
    digest.update(path.relative(root, file).split(path.sep).join('/'))
    digest.update('\0')
    digest.update(fs.readFileSync(file))
    digest.update('\0')
  }
  return digest.digest('hex')
}

function fail (message) {
  process.stderr.write(`[scope-audit] ${message}\n`)
  process.exitCode = 2
  throw new Error(message)
}

function walkFiles (directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...walkFiles(file))
    else result.push(file)
  }
  return result
}

function stripComments (source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

function unique (values) {
  return [...new Set(values.filter(Boolean))]
}

function extractLiteralEndpoints (source) {
  const clean = stripComments(source)
  const endpoints = []
  const seen = new Set()
  const add = (verb, url, evidence) => {
    const value = url.split('?')[0]
    if (!value || !/^\//.test(value)) return
    const key = `${verb.toUpperCase()} ${value}`
    if (seen.has(key)) return
    seen.add(key)
    endpoints.push({ verb: verb.toUpperCase(), path: value, evidence })
  }

  for (const match of clean.matchAll(/\b(?:http|request|axios)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/g)) {
    add(match[1], match[3], 'http.' + match[1])
  }
  for (const match of clean.matchAll(/\b(getDataListURL|objectURL|detailURL|saveURL|deleteURL|updateURL|createURL|exportURL|importURL)\s*:\s*(['"`])([^'"`]+)\2/g)) {
    add(match[1].replace(/URL$/, ''), match[3], match[1])
  }

  for (const { body } of extractHttpConfigObjects(clean)) {
    const methods = extractObjectFieldValues(body, 'method')
      .flatMap((value) => [...value.matchAll(/['"`]\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*['"`]/gi)].map((match) => match[1]))
    const urls = extractObjectFieldValues(body, 'url')
      .flatMap((value) => [...value.matchAll(/['"`]([^'"`]+)['"`]/g)].map((match) => match[1]))
    const verbs = unique(methods).length > 0 ? unique(methods) : ['GET']
    const uniqueUrls = unique(urls)
    if (verbs.length > 1 && verbs.length === uniqueUrls.length) {
      verbs.forEach((verb, index) => add(verb, uniqueUrls[index], 'http-config:method/url'))
    } else {
      for (const url of uniqueUrls) {
        for (const verb of verbs) add(verb, url, 'http-config:method/url')
      }
    }
  }
  return endpoints
}

function extractUnresolvedEndpointEvidence (source) {
  const unresolved = []
  for (const { body } of extractHttpConfigObjects(stripComments(source))) {
    for (const expression of extractObjectFieldValues(body, 'url')) {
      if (/['"`]\s*\//.test(expression)) continue
      unresolved.push({ evidence: 'http-config:url', expression: expression.trim().replace(/\s+/g, ' ').slice(0, 240) })
    }
  }
  const seen = new Set()
  return unresolved.filter((value) => {
    const key = `${value.evidence}:${value.expression}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractHttpConfigObjects (source) {
  const result = []
  const callPattern = /\b(?:http|request|axios|platformHttp)\s*\(\s*\{/g
  for (const match of source.matchAll(callPattern)) {
    const open = source.indexOf('{', match.index)
    let depth = 0
    let quote = null
    let escaped = false
    for (let index = open; index < source.length; index += 1) {
      const char = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === '{') depth += 1
      if (char === '}' && --depth === 0) {
        result.push({ body: source.slice(open + 1, index) })
        break
      }
    }
  }
  return result
}

function extractObjectFieldValues (body, field) {
  const values = []
  for (const match of body.matchAll(new RegExp(`\\b${field}\\s*:`,'g'))) {
    const start = match.index + match[0].length
    let depth = 0
    let quote = null
    let escaped = false
    for (let index = start; index < body.length; index += 1) {
      const char = body[index]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === '{' || char === '[' || char === '(') depth += 1
      if (char === '}' || char === ']' || char === ')') depth -= 1
      if (depth === 0 && char === ',') {
        values.push(body.slice(start, index))
        break
      }
      if (index === body.length - 1) values.push(body.slice(start))
    }
  }
  return values
}

function extractActionHints (source) {
  const clean = stripComments(source)
  const hints = []
  const seen = new Set()
  const add = (value, evidence) => {
    const normalized = value.replace(/^action/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
    if (!normalized || normalized.length < 2) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    hints.push({ action: normalized, evidence })
  }

  for (const match of clean.matchAll(/\b(action[A-Z][A-Za-z0-9_]*)\s*\(/g)) add(match[1], match[1])
  for (const match of clean.matchAll(/\b(rrList\.)?(action[A-Z][A-Za-z0-9_]*)/g)) add(match[2], match[2])

  const labels = '新增|编辑|修改|删除|批量删除|详情|查看|导入|导出|下载|上传|保存|提交|撤回|撤销|审批|通过|驳回|转交|催办|评论|启用|禁用|停用|归档|反归档|发布|取消发布|预览|复制|同步|配置|分配|结转|重置|历史|打印|完成'
  for (const match of clean.matchAll(new RegExp(`(?:title|label|text|按钮|操作)\\s*[:=]\\s*['"](${labels})['"]|>\\s*(${labels})\\s*<`, 'g'))) {
    add(match[1] || match[2], 'visible-label')
  }
  return hints
}

function extractRouteReferences (source) {
  const clean = stripComments(source)
  return unique([
    ...[...clean.matchAll(/(?:router|\$router)\.(?:push|replace)\s*\(\s*[`'"`]([^`'"`]+)[`'"`]/g)].map((m) => m[1].split('?')[0]),
    ...[...clean.matchAll(/\bpath\s*:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1].split('?')[0]),
  ]).filter((value) => value.startsWith('/'))
}

function extractLocalRouteReferences (source) {
  const clean = stripComments(source)
  return unique([
    ...[...clean.matchAll(/\b(?:router|\$router)\.(?:push|replace)\s*\(\s*([`'\"])([^`'\"]+)\1/g)].map((match) => match[2]),
    ...[...clean.matchAll(/\bpath\s*:\s*([`'\"])([^`'\"]+)\1/g)].map((match) => match[2]),
    ...[...clean.matchAll(/\b(?:const|let|var)\s+(?:path|target|routePath)\s*=\s*([`'\"])([^`'\"]+)\1/g)].map((match) => match[2]),
  ]).filter((value) => value.startsWith('./') || value.startsWith('../'))
}

function interpolateRouteReference (reference) {
  return reference
    .split('?')[0]
    .split('#')[0]
    .replace(/\$\{[^}]*?([A-Za-z_$][\w$]*)\s*\}/g, '[$1]')
    .replace(/\$\{[^}]+\}/g, '[param]')
}

function routeFileCandidates (target) {
  const candidates = [target]
  if (!path.extname(target)) {
    candidates.push(`${target}.vue`, `${target}.js`, `${target}.ts`, path.join(target, 'index.vue'), path.join(target, 'index.js'))
  }
  return unique(candidates)
}

function resolveLocalRouteFile (sourceFile, reference) {
  const target = path.resolve(path.dirname(sourceFile), interpolateRouteReference(reference))
  const viewsRoot = path.join(PORTAL_REPO, 'app/portal/views')
  if (target !== viewsRoot && !target.startsWith(`${viewsRoot}${path.sep}`)) return null
  return routeFileCandidates(target).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null
}

function isHiddenRouteFile (file, rootDirectory) {
  const segments = path.relative(rootDirectory, file).split(path.sep)
  if (segments.includes('components') || segments.includes('component') || segments.includes('api')) return false
  return segments.some((segment) => /^\[.+\]$/.test(segment) || /^(?:detail|action|actions|edit|create|review|approval|form)$/.test(segment))
}

function findImplicitHiddenRouteFiles (sourceFile) {
  const rootDirectory = path.dirname(sourceFile)
  return walkFiles(rootDirectory)
    .filter((file) => file !== sourceFile && /\.vue$/.test(file) && isHiddenRouteFile(file, rootDirectory))
}

function collectRouteEvidence (rootSource) {
  if (!rootSource) return { sources: [], localRouteReferences: [], unresolvedLocalRoutes: [] }
  const sources = []
  const byFile = new Map()
  const localRouteReferences = []
  const unresolvedLocalRoutes = []
  const queue = [{ file: rootSource.file, source: rootSource.source, kind: 'menu-route', reference: null }]
  while (queue.length > 0) {
    const current = queue.shift()
    if (byFile.has(current.file)) continue
    byFile.set(current.file, current)
    sources.push(current)
    for (const reference of extractLocalRouteReferences(current.source)) {
      const resolved = resolveLocalRouteFile(current.file, reference)
      const evidence = {
        reference,
        fromRouteFile: path.relative(PORTAL_REPO, current.file).split(path.sep).join('/'),
        routeFile: resolved ? path.relative(PORTAL_REPO, resolved).split(path.sep).join('/') : null,
        kind: resolved ? 'local-relative-route' : 'unresolved-local-route',
      }
      localRouteReferences.push(evidence)
      if (resolved) queue.push({ file: resolved, source: fs.readFileSync(resolved, 'utf8'), kind: 'reachable-hidden-route', reference })
      else unresolvedLocalRoutes.push(evidence)
    }
    for (const file of findImplicitHiddenRouteFiles(current.file)) {
      if (byFile.has(file)) continue
      queue.push({ file, source: fs.readFileSync(file, 'utf8'), kind: 'implicit-hidden-route', reference: null })
    }
  }
  return { sources, localRouteReferences, unresolvedLocalRoutes }
}

function extractStaticActionFunctions (source) {
  const clean = stripComments(source)
  const definitions = unique([
    ...[...clean.matchAll(/\b(?:async\s+)?function\s+(action[A-Z][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]),
    ...[...clean.matchAll(/\b(?:const|let|var)\s+(action[A-Z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/g)].map((match) => match[1]),
  ])
  const bindings = new Set([...clean.matchAll(/@(?:click|change|finish|submit|dblclick|contextmenu)\s*=\s*["'`]([^"'`]+)["'`]/g)].flatMap((match) => [...match[1].matchAll(/\b(action[A-Z][A-Za-z0-9_]*)\b/g)].map((item) => item[1])))
  const unbound = definitions.filter((name) => !bindings.has(name))
  return { definitions, bindings: [...bindings], unbound }
}

function extractActionEvidence (routeSource) {
  const hints = extractActionHints(routeSource.source)
  const staticActions = extractStaticActionFunctions(routeSource.source)
  const routeFile = path.relative(PORTAL_REPO, routeSource.file).split(path.sep).join('/')
  const evidence = hints.map((hint) => ({
    ...hint,
    routeFile,
    category: routeSource.kind === 'menu-route'
      ? (hint.evidence === 'visible-label' || staticActions.bindings.includes(hint.evidence) ? 'reachable-button' : 'static-action')
      : 'hidden-route-action',
  }))
  for (const action of staticActions.unbound) evidence.push({ action, evidence: 'static-function-definition', category: 'unbound-static-function', routeFile })
  return { evidence, staticActions }
}

function collectJavaEndpointEvidence () {
  if (!fs.existsSync(JAVA_REPO)) return { status: 'unavailable', filesScanned: 0, paths: new Set(), sources: [] }
  const files = walkFiles(JAVA_REPO).filter((file) => file.endsWith('.java'))
  const sources = files.map((file) => ({ file, source: stripComments(fs.readFileSync(file, 'utf8')) }))
  const paths = new Set()
  for (const { source } of sources) {
    for (const match of source.matchAll(/["'](\/[^"'\s]+)["']/g)) paths.add(normalizeEndpointPath(match[1]))
  }
  return { status: 'available', filesScanned: files.length, paths, sources }
}

let javaEndpointEvidenceCache = null

function javaEndpointStatus (endpoint) {
  javaEndpointEvidenceCache ??= collectJavaEndpointEvidence()
  const index = javaEndpointEvidenceCache
  if (index.status === 'unavailable') return { status: 'unavailable', detail: `找不到 Java 源码：${JAVA_REPO}` }
  if (endpoint.resolution === 'unresolved') return { status: 'unresolved', detail: 'Portal URL 是动态表达式，无法与 Java 端点静态配对' }
  const normalized = normalizeEndpointPath(endpoint.path)
  if (index.paths.has(normalized)) return { status: 'matched', detail: 'Java 源码存在同路径字面量' }
  const suffix = normalized.split('/').filter(Boolean).slice(-2).join('/')
  if (suffix && index.sources.some(({ source }) => source.includes(suffix))) return { status: 'unresolved', detail: `Java 源码命中后缀 ${suffix}，但未命中完整路径（可能含类级前缀或 ${'${sysPath}'}）` }
  return { status: 'missing', detail: 'Java 源码未找到完整路径或稳定后缀字面量；不等于运行时端点不存在' }
}

function inspectBuildFreshness (distFile = DIST_FILE) {
  const sourceFiles = walkFiles(SRC_DIRECTORY).filter((file) => /\.ts$/.test(file))
  const sourceContentHash = contentHash(sourceFiles, ROOT)
  if (!fs.existsSync(distFile) || !fs.existsSync(BUILD_MANIFEST_FILE)) {
    return {
      status: 'missing',
      method: 'content-hash-v1',
      distFile: relative(distFile),
      manifestFile: relative(BUILD_MANIFEST_FILE),
      sourceFileCount: sourceFiles.length,
      sourceContentHash,
    }
  }
  let manifest
  try {
    manifest = readJson(BUILD_MANIFEST_FILE)
  } catch {
    return {
      status: 'stale',
      method: 'content-hash-v1',
      distFile: relative(distFile),
      manifestFile: relative(BUILD_MANIFEST_FILE),
      sourceFileCount: sourceFiles.length,
      sourceContentHash,
      detail: '构建清单不是有效 JSON',
    }
  }
  const distFiles = walkFiles(path.dirname(distFile)).filter((file) => file !== BUILD_MANIFEST_FILE)
  const distContentHash = contentHash(distFiles, path.dirname(distFile))
  const sourceMatches = manifest.sourceContentHash === sourceContentHash
  const distMatches = manifest.distContentHash === distContentHash
  return {
    status: sourceMatches && distMatches ? 'fresh' : 'stale',
    method: 'content-hash-v1',
    distFile: relative(distFile),
    manifestFile: relative(BUILD_MANIFEST_FILE),
    sourceFileCount: sourceFiles.length,
    sourceContentHash,
    recordedSourceContentHash: manifest.sourceContentHash ?? null,
    distContentHash,
    recordedDistContentHash: manifest.distContentHash ?? null,
    sourceMatches,
    distMatches,
  }
}

function endpointSystem (endpoint) {
  const value = endpoint.path
  if (value.startsWith('/admin-api/finance/') || value.startsWith('/finance/')) return 'finance'
  if (value.startsWith('/admin-api/inventory/') || value.startsWith('/inventory/')) return 'material'
  if (value.startsWith('/admin-api/product/') || value.startsWith('/product/')) return 'product'
  if (value.startsWith('/admin-api/sale/') || value.startsWith('/sale/')) return 'sale'
  if (value.startsWith('/admin-api/supply/') || value.startsWith('/supply/')) return 'supply'
  if (value.startsWith('/admin-api/technology/') || value.startsWith('/technology/')) return 'technology'
  if (value.startsWith('/admin-api/hr/') || value.startsWith('/org/') || value.startsWith('/bpm/') || value.startsWith('/salary/')) return 'hr'
  if (value.startsWith('/admin-api/system/') || value.startsWith('/sys/')) return 'common'
  return 'unknown'
}

function findDoc (title, menuPath) {
  const directory = path.join(ROOT, 'docs/pages')
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.md')) : []
  const titleNeedle = `# ${title}`
  for (const name of files) {
    const file = path.join(directory, name)
    const content = fs.readFileSync(file, 'utf8')
    if (content.includes(menuPath) || content.includes(titleNeedle)) return relative(file)
  }
  return null
}

function containsToken (content, token) {
  let offset = 0
  while (true) {
    const index = content.indexOf(token, offset)
    if (index === -1) return false
    const before = content[index - 1] ?? ''
    const after = content[index + token.length] ?? ''
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) return true
    offset = index + token.length
  }
}

function findTestEvidence (capabilityIds, menuPath, testDirectory = path.join(ROOT, 'test')) {
  const files = walkFiles(testDirectory).filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file))
  const byCapability = new Map(capabilityIds.map((id) => [id, []]))
  const evidenceFiles = []
  for (const file of files) {
    if (/(?:scope-model|scope-audit|page-catalog-generator|next-scope)\.test\./.test(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    const matchedCapabilityIds = capabilityIds.filter((id) => containsToken(content, id))
    const matchesPage = content.includes(`'${menuPath}'`) || content.includes(`"${menuPath}"`)
    if (matchedCapabilityIds.length === 0 && !matchesPage) continue
    const displayFile = file.startsWith(ROOT + path.sep) ? relative(file) : file
    evidenceFiles.push(displayFile)
    for (const id of matchedCapabilityIds) byCapability.get(id).push(displayFile)
  }
  const testEvidenceFiles = unique(evidenceFiles)
  const testedCapabilityIds = capabilityIds.filter((id) => byCapability.get(id).length > 0)
  return {
    testEvidenceFiles,
    testedCapabilityIds,
    untestedCapabilityIds: capabilityIds.filter((id) => !testedCapabilityIds.includes(id)),
    testEvidenceByCapability: Object.fromEntries(capabilityIds.map((id) => [id, unique(byCapability.get(id))])),
  }
}

function catalogContentHash (catalog) {
  const { generatedAt: _ignoredCatalogTimestamp, ...catalogContent } = catalog
  return hash(JSON.stringify(catalogContent))
}

function readPortalSource (routeFile) {
  if (!routeFile) return null
  const file = path.join(PORTAL_REPO, routeFile)
  if (!fs.existsSync(file)) return null
  return { file, source: fs.readFileSync(file, 'utf8') }
}

function normalizeEndpointPath (value) {
  return value
    .split('?')[0]
    .replace(/^\/admin-api(?=\/)/, '')
    .replace(/^\/mall-manage-api(?=\/)/, '')
    .replace(/\/+/g, '/')
}

function isLikelyReadEndpoint (endpoint) {
  const pathValue = normalizeEndpointPath(endpoint.path)
  if (endpoint.verb === 'GET' || endpoint.verb === 'GETDATALIST') return true
  // A few Portal dashboard widgets use POST for read-only statistics. Keep
  // those out of the action audit; the SDK still has to cover them as reads.
  return /(?:^|\/)(?:page|list|search|query|summary|statistics|trend|ratio|ranking|detail|info|options|tree|history|usage|quota|model|typeList|function-module|organization|calendar|analysis|available|record|records|logs?)(?:$|\/)/i.test(pathValue)
}

function sourceSupportsEndpoint (source, endpoint) {
  const normalized = normalizeEndpointPath(endpoint.path)
  if (source.includes(endpoint.path) || source.includes(normalized)) return true
  const roots = [...source.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ name: match[1], path: normalizeEndpointPath(match[2]) }))
  for (const { name, path: root } of roots) {
    if (!root || !normalized.startsWith(`${root}/`)) continue
    const remainder = normalized.slice(root.length)
    const firstSegment = remainder.split('/').filter(Boolean)[0]
    if (firstSegment && source.includes(`/${firstSegment}`)) return true
    // Portal commonly keeps the action suffix dynamic, e.g.
    // `${ROOT}/${draft.status ? 'open' : 'close'}`. The concrete endpoint
    // cannot be found as a literal, but the named root plus a template
    // segment is sufficient evidence for an endpoint under that root.
    if (source.includes('`${' + name + '}/')) return true
  }
  // Template-literal calls with a literal path prefix (for example
  // `${DELETE_URL_PREFIX}${id}` or `/hr/meeting-room/delete/${id}`) cannot
  // contain the complete dynamic URL as text. Compare the stable prefix only.
  const stablePrefix = normalized.replace(/\/\$\{[^}]+\}(?:\/.*)?$/, '')
  if (stablePrefix.length >= 8 && source.includes(`${stablePrefix}/`)) return true
  // Template-literal endpoints often retain only a stable suffix in the
  // capability source, e.g. `${ROOT}/update-status`.
  const suffix = normalized.split('/').slice(-2).join('/')
  return suffix.length >= 6 && source.includes(`/${suffix}`)
}

function capabilitySourceFilesForPage (pagePath) {
  const directory = path.join(ROOT, 'src/capabilities')
  return walkFiles(directory)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
    .filter(({ source }) => source.includes(pagePath))
}

function issue (kind, key, detail) {
  return { key: `${kind}:${key}`, kind, detail }
}

function buildAudit ({ scope, catalog, sdk, buildGate = inspectBuildFreshness() }) {
  const scoped = scope.items.filter((item) => item.included && item.menuPath !== null)
  const catalogByPath = new Map(catalog.items.filter((item) => item.menuPath).map((item) => [item.menuPath, item]))
  const capabilities = sdk.capabilities
  const capabilitiesByPage = new Map()
  for (const capability of capabilities) {
    const list = capabilitiesByPage.get(capability.pagePath) ?? []
    list.push(capability)
    capabilitiesByPage.set(capability.pagePath, list)
  }

  const pages = []
  const structuralIssues = []
  const evidenceGaps = []
  if (buildGate.status !== 'fresh') {
    const kind = buildGate.status === 'missing' ? 'build-missing' : 'build-stale'
    structuralIssues.push(issue(kind, buildGate.distFile, `dist 不能证明与当前 src 一致（${buildGate.status}，${buildGate.method}）；不能静默使用旧构建产物`))
  }
  for (const scopeItem of scoped) {
    const row = catalogByPath.get(scopeItem.menuPath)
    const source = readPortalSource(row?.routeFile ?? null)
    const sourceRelative = source ? path.relative(PORTAL_REPO, source.file).split(path.sep).join('/') : row?.routeFile ?? null
    const sourceText = source?.source ?? ''
    const routeEvidence = collectRouteEvidence(source)
    const actions = extractActionHints(sourceText)
    const actionEvidence = routeEvidence.sources.flatMap((routeSource) => extractActionEvidence(routeSource).evidence)
    const endpoints = routeEvidence.sources.flatMap((routeSource) => extractLiteralEndpoints(routeSource.source))
      .reduce((all, endpoint) => {
        const key = `${endpoint.verb} ${endpoint.path}`
        const previous = all.find((value) => `${value.verb} ${value.path}` === key)
        if (previous) {
          previous.evidence = unique([previous.evidence, endpoint.evidence]).join(', ')
          return all
        }
        all.push({ ...endpoint })
        return all
      }, [])
    const unresolvedEndpoints = routeEvidence.sources.flatMap((routeSource) => extractUnresolvedEndpointEvidence(routeSource.source).map((endpoint) => ({
      ...endpoint,
      routeFile: path.relative(PORTAL_REPO, routeSource.file).split(path.sep).join('/'),
    })))
    const routes = extractRouteReferences(sourceText)
    const attached = capabilitiesByPage.get(scopeItem.menuPath) ?? []
    const descriptions = attached.map((capability) => sdk.catalog.describe(capability.id))
    const capabilityIds = attached.map((capability) => capability.id)
    const missingAi = descriptions.filter((description) => !description.ok || description.ai === undefined).map((description, index) => capabilityIds[index])
    const aiGaps = descriptions.flatMap((description, index) => description.ok ? (description.ai?.gaps ?? []).map((gap) => ({ capabilityId: capabilityIds[index], gap })) : [])
    const doc = findDoc(scopeItem.title, scopeItem.menuPath)
    const test = findTestEvidence(capabilityIds, scopeItem.menuPath)
    const functionalCoverage = 'unverified'
    const dependencies = endpoints.map((endpoint) => {
      const endpointSources = routeEvidence.sources
        .filter((routeSource) => extractLiteralEndpoints(routeSource.source).some((candidate) => candidate.verb === endpoint.verb && candidate.path === endpoint.path))
        .map((routeSource) => path.relative(PORTAL_REPO, routeSource.file).split(path.sep).join('/'))
      const java = javaEndpointStatus(endpoint)
      return {
        ...endpoint,
        sourceSystem: endpointSystem(endpoint),
        routeSourceFiles: endpointSources,
        java,
      }
    })
    const capabilitySources = capabilitySourceFilesForPage(scopeItem.menuPath)
    const actionDependencies = dependencies
      .filter((endpoint) => !isLikelyReadEndpoint(endpoint))
      .map((endpoint) => {
        const supportFiles = capabilitySources
          .filter(({ source }) => sourceSupportsEndpoint(source, endpoint))
          .map(({ file }) => relative(file))
        return {
          ...endpoint,
          covered: supportFiles.length > 0,
          supportingCapabilitySourceFiles: supportFiles,
        }
      })
    const actionGaps = actionDependencies
      .filter((endpoint) => !endpoint.covered)
      .map((endpoint) => issue('action-uncovered', `${scopeItem.menuPath}:${endpoint.verb}:${endpoint.path}`, `Portal写端点未在同页SDK能力源码中找到支撑：${endpoint.verb} ${endpoint.path}`))
    const javaEndpointGaps = dependencies
      .filter((endpoint) => endpoint.java.status !== 'matched')
      .map((endpoint) => issue(`java-endpoint-${endpoint.java.status}`, `${scopeItem.menuPath}:${endpoint.verb}:${endpoint.path}`, `${endpoint.java.detail}：${endpoint.verb} ${endpoint.path}`))
    const unresolvedEndpointGaps = unresolvedEndpoints
      .map((endpoint, index) => issue('endpoint-unresolved', `${scopeItem.menuPath}:${index}`, `Portal http 配置的 url 不是静态字面量，未解析：${endpoint.expression}`))
    const status = scopeItem.status === 'external'
      ? 'external'
      : attached.length === 0
        ? 'missing'
        : missingAi.length > 0 || aiGaps.length > 0 || actionGaps.length > 0 || doc === null || test.untestedCapabilityIds.length > 0
          ? 'partial'
          : 'registered-unverified'

    const pageIssues = []
    const pageEvidenceGaps = []
    if (!row) pageIssues.push(issue('catalog-missing', scopeItem.menuPath, '保留菜单路径不在 page-catalog'))
    if (row && row.menuSource !== scopeItem.menuSource) pageIssues.push(issue('source-drift', scopeItem.menuPath, `${scopeItem.menuSource} != ${row.menuSource}`))
    if (row && row.permission !== scopeItem.permission) pageIssues.push(issue('permission-source-drift', scopeItem.menuPath, `${scopeItem.permission} != ${row.permission}`))
    if (!source) pageIssues.push(issue('route-missing', scopeItem.menuPath, `找不到路由源码：${row?.routeFile ?? '(未解析)'}`))
    if (attached.length === 0) pageIssues.push(issue('capability-missing', scopeItem.menuPath, '页面没有绑定 capability'))
    const permissionDrift = attached
      .filter((capability) => capability.permission !== undefined && capability.permission !== row?.permission)
      .map((capability) => `${capability.id}=${capability.permission}`)
    if (permissionDrift.length > 0) pageIssues.push(issue('capability-permission-drift', scopeItem.menuPath, permissionDrift.join(', ')))
    if (actions.length > 0 && attached.length === 0) pageIssues.push(issue('action-uncovered', scopeItem.menuPath, `源码发现 ${actions.length} 个动作线索但没有 capability`))
    if (missingAi.length > 0) pageEvidenceGaps.push(issue('ai-contract-missing', scopeItem.menuPath, missingAi.join(', ')))
    for (const [index, gap] of aiGaps.entries()) {
      pageEvidenceGaps.push(issue('ai-gap', `${scopeItem.menuPath}:${gap.capabilityId}:${index}`, gap.gap))
    }
    if (doc === null) pageEvidenceGaps.push(issue('page-doc-missing', scopeItem.menuPath, 'docs/pages 没有页面四件套文档'))
    if (test.testEvidenceFiles.length === 0) pageEvidenceGaps.push(issue('page-test-missing', scopeItem.menuPath, 'test/ 没有按能力或菜单路径命中的回归测试'))
    if (test.untestedCapabilityIds.length > 0) pageEvidenceGaps.push(issue('capability-test-missing', scopeItem.menuPath, `未逐 capability 命中测试：${test.untestedCapabilityIds.join(', ')}`))
    pageEvidenceGaps.push(...actionGaps)
    pageEvidenceGaps.push(...javaEndpointGaps)
    pageEvidenceGaps.push(...unresolvedEndpointGaps)
    if (routeEvidence.unresolvedLocalRoutes.length > 0) {
      pageEvidenceGaps.push(issue('route-unresolved', scopeItem.menuPath, `存在 ${routeEvidence.unresolvedLocalRoutes.length} 个未解析的本地相对路由引用`))
    }
    if (functionalCoverage === 'unverified') pageEvidenceGaps.push(issue('functional-coverage-unverified', scopeItem.menuPath, '未用浏览器或真实测试环境验证功能行为'))
    for (const pageIssue of pageIssues) structuralIssues.push(pageIssue)
    for (const pageEvidenceGap of pageEvidenceGaps) evidenceGaps.push(pageEvidenceGap)

    pages.push({
      key: scopeItem.key,
      rootId: scopeItem.rootId,
      title: scopeItem.title,
      menuPath: scopeItem.menuPath,
      permission: scopeItem.permission,
      parentTitles: scopeItem.parentTitles,
      menuSource: scopeItem.menuSource,
      sourceSystem: scopeItem.sourceSystem,
      routeFile: row?.routeFile ?? null,
      routeSource: sourceRelative,
      routeEvidence: routeEvidence.sources.map((routeSource) => ({
        routeFile: path.relative(PORTAL_REPO, routeSource.file).split(path.sep).join('/'),
        kind: routeSource.kind,
        reference: routeSource.reference,
      })),
      localRouteReferences: routeEvidence.localRouteReferences,
      unresolvedLocalRoutes: routeEvidence.unresolvedLocalRoutes,
      kind: row?.kind ?? null,
      writeHint: row?.write ?? null,
      actions,
      actionEvidence,
      reachableButtonActions: unique(actionEvidence.filter((value) => value.category === 'reachable-button').map((value) => value.action)),
      hiddenRouteActions: unique(actionEvidence.filter((value) => value.category === 'hidden-route-action').map((value) => value.action)),
      unboundStaticFunctions: unique(actionEvidence.filter((value) => value.category === 'unbound-static-function').map((value) => value.action)),
      routeReferences: routes,
      dependencies,
      unresolvedEndpoints,
      actionDependencies,
      actionGaps: actionGaps.map((value) => value.key),
      javaEndpointGaps: javaEndpointGaps.map((value) => value.key),
      unresolvedEndpointGaps: unresolvedEndpointGaps.map((value) => value.key),
      capabilityIds,
      docs: doc,
      // 保留单文件字段供旧消费者读取；逐 capability 字段才是测试证据的完整表达。
      testEvidence: test.testEvidenceFiles[0] ?? null,
      testEvidenceFiles: test.testEvidenceFiles,
      testedCapabilityIds: test.testedCapabilityIds,
      untestedCapabilityIds: test.untestedCapabilityIds,
      testEvidenceByCapability: test.testEvidenceByCapability,
      aiGaps,
      missingAiCapabilityIds: missingAi,
      status,
      functionalCoverage,
      issues: pageIssues.map((value) => value.key),
      evidenceGaps: pageEvidenceGaps.map((value) => value.key),
    })
  }

  const retainedPaths = new Set(scoped.map((item) => item.menuPath))
  const dependencyOnlyCapabilities = capabilities.filter((capability) => DEPENDENCY_ONLY_PAGE_PATHS.has(capability.pagePath))
  const outsideMenuCapabilities = capabilities.filter((capability) => capability.pagePath && capability.pagePath.startsWith('/dashboard/') && !retainedPaths.has(capability.pagePath) && !DEPENDENCY_ONLY_PAGE_PATHS.has(capability.pagePath))
  const outsideScopeCapabilityIds = outsideMenuCapabilities.map((capability) => capability.id)
  for (const capability of outsideMenuCapabilities) {
    structuralIssues.push(issue('outside-scope-capability', capability.id, `pagePath=${capability.pagePath}`))
  }

  const previous = fs.existsSync(OUTPUT_FILE) ? readJson(OUTPUT_FILE) : null
  const previousStructuralIssues = previous?.structuralIssues ?? previous?.issues ?? []
  const previousEvidenceGaps = previous?.evidenceGaps ?? []
  const previousStructuralKeys = new Set(previousStructuralIssues.map((value) => value.key))
  const currentStructuralKeys = new Set(structuralIssues.map((value) => value.key))
  const previousEvidenceKeys = new Set(previousEvidenceGaps.map((value) => value.key))
  const currentEvidenceKeys = new Set(evidenceGaps.map((value) => value.key))
  const newStructuralIssues = structuralIssues.filter((value) => !previousStructuralKeys.has(value.key))
  const resolvedStructuralIssues = previousStructuralIssues.filter((value) => !currentStructuralKeys.has(value.key))
  const newEvidenceGaps = evidenceGaps.filter((value) => !previousEvidenceKeys.has(value.key))
  const resolvedEvidenceGaps = previousEvidenceGaps.filter((value) => !currentEvidenceKeys.has(value.key))
  const allCapabilityIds = unique(pages.flatMap((page) => page.capabilityIds))
  const testedCapabilityIds = unique(pages.flatMap((page) => page.testedCapabilityIds))
  const untestedCapabilityIds = allCapabilityIds.filter((id) => !testedCapabilityIds.includes(id))
  const aiGapCount = pages.reduce((count, page) => count + page.aiGaps.length + page.missingAiCapabilityIds.length, 0)
  return {
    schema: 'portal-scope-audit/v1',
    source: {
      portalRepo: PORTAL_REPO,
      javaRepo: JAVA_REPO,
      portalRevision: (() => { try { return execFileSync('git', ['-C', PORTAL_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'unknown' } })(),
      scopeSourceRevision: scope.sourceRevision,
      scopeContentHash: scope.sourceContentHash,
      catalogContentHash: catalogContentHash(catalog),
      buildGate,
    },
    summary: {
      retainedCallablePages: pages.length,
      withCapability: pages.filter((page) => page.capabilityIds.length > 0).length,
      missingCapability: pages.filter((page) => page.capabilityIds.length === 0).length,
      partial: pages.filter((page) => page.status === 'partial').length,
      registeredUnverified: pages.filter((page) => page.status === 'registered-unverified').length,
      external: scope.items.filter((item) => item.included && item.status === 'external').length,
      dependencyOnlyCapabilityCount: dependencyOnlyCapabilities.length,
      outsideScopeCapabilityCount: outsideScopeCapabilityIds.length,
      // issueCount remains a compatibility field, but now means structural issues only.
      issueCount: structuralIssues.length,
      structuralIssueCount: structuralIssues.length,
      newIssueCount: newStructuralIssues.length,
      newStructuralIssueCount: newStructuralIssues.length,
      resolvedIssueCount: resolvedStructuralIssues.length,
      resolvedStructuralIssueCount: resolvedStructuralIssues.length,
      evidenceGapCount: evidenceGaps.length,
      newEvidenceGapCount: newEvidenceGaps.length,
      resolvedEvidenceGapCount: resolvedEvidenceGaps.length,
      aiGapCount,
      actionGapCount: pages.reduce((count, page) => count + page.actionGaps.length, 0),
      pagesWithActionGaps: pages.filter((page) => page.actionGaps.length > 0).length,
      routeEvidenceCount: pages.reduce((count, page) => count + page.routeEvidence.length, 0),
      hiddenRouteCount: pages.reduce((count, page) => count + page.routeEvidence.filter((route) => route.kind !== 'menu-route').length, 0),
      reachableButtonActionCount: pages.reduce((count, page) => count + page.reachableButtonActions.length, 0),
      hiddenRouteActionCount: pages.reduce((count, page) => count + page.hiddenRouteActions.length, 0),
      unboundStaticFunctionCount: pages.reduce((count, page) => count + page.unboundStaticFunctions.length, 0),
      javaEndpointGapCount: pages.reduce((count, page) => count + page.javaEndpointGaps.length, 0),
      unresolvedEndpointCount: pages.reduce((count, page) => count + page.unresolvedEndpoints.length, 0),
      javaUnavailablePageCount: pages.filter((page) => page.dependencies.some((dependency) => dependency.java.status === 'unavailable')).length,
      pagesWithEvidenceGaps: pages.filter((page) => page.evidenceGaps.length > 0).length,
      functionalCoverageUnverified: pages.filter((page) => page.functionalCoverage === 'unverified').length,
      testedCapabilityCount: testedCapabilityIds.length,
      untestedCapabilityCount: untestedCapabilityIds.length,
      capabilityTestCoverage: allCapabilityIds.length === 0 ? null : testedCapabilityIds.length / allCapabilityIds.length,
    },
    pages,
    dependencyOnlyCapabilityIds: dependencyOnlyCapabilities.map((capability) => capability.id),
    outsideScopeCapabilityIds,
    testedCapabilityIds,
    untestedCapabilityIds,
    structuralIssues,
    evidenceGaps,
    // Compatibility alias for consumers that still read `issues`.
    issues: structuralIssues,
  }
}

function renderMarkdown (audit) {
  const lines = [
    '# 保留菜单逐页审计矩阵',
    '',
    '> 本文件由 `tools/generate/scope-audit.mjs` 生成。动作和接口来自路由源码静态线索；`registered-unverified` 与 `functionalCoverage=unverified` 明确表示尚未用浏览器/真实环境证明，不能当作 100% 功能完成。',
    '',
    `- Portal 来源提交：\`${audit.source.portalRevision}\``,
    `- 保留可调用页面：${audit.summary.retainedCallablePages}；已挂能力：${audit.summary.withCapability}；缺能力：${audit.summary.missingCapability}`, 
    `- 结构问题：${audit.summary.structuralIssueCount}；本次新增结构问题：${audit.summary.newStructuralIssueCount}；已解决：${audit.summary.resolvedStructuralIssueCount}`,
    `- 证据缺口：${audit.summary.evidenceGapCount}；本次新增证据缺口：${audit.summary.newEvidenceGapCount}；涉及页面：${audit.summary.pagesWithEvidenceGaps}`,
    `- AI 缺口：${audit.summary.aiGapCount}；未逐项命中测试的 capability：${audit.summary.untestedCapabilityCount}；真实验证未完成页面：${audit.summary.functionalCoverageUnverified}`,
    `- 动作缺口：${audit.summary.actionGapCount}；存在动作缺口的页面：${audit.summary.pagesWithActionGaps}`,
    `- 路由证据：${audit.summary.routeEvidenceCount} 个文件，其中隐藏路由 ${audit.summary.hiddenRouteCount}；可达按钮动作 ${audit.summary.reachableButtonActionCount}；隐藏路由动作 ${audit.summary.hiddenRouteActionCount}；未绑定静态函数 ${audit.summary.unboundStaticFunctionCount}`,
    `- Java 端点：${audit.summary.javaEndpointGapCount} 个未静态匹配；Java 源码不可用页面 ${audit.summary.javaUnavailablePageCount}；构建门禁 ${audit.source.buildGate.status}`,
    '- 结构问题为 0 不等于业务功能已完成；真实读写、浏览器基准和写入回查仍以页面 evidenceGaps 为准。',
    `- 流程隐藏依赖 capability：${audit.summary.dependencyOnlyCapabilityCount}；范围外 dashboard capability 候选：${audit.summary.outsideScopeCapabilityCount}`,
    '',
    '| 根 | 页面 | 菜单路径 | 状态 | capability | 动作线索 | 支撑接口 | 未覆盖写端点 | 文档 | 测试 | 未逐项测试 | 结构问题 | 证据缺口 |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |',
  ]
  for (const page of audit.pages) {
    const cell = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
    lines.push(`| ${cell(page.rootId)} | ${cell(page.title)} | ${cell(page.menuPath)} | ${cell(page.status)} | ${cell(page.capabilityIds.join(', '))} | ${page.actions.length} | ${page.dependencies.length} | ${page.actionGaps.length} | ${cell(page.docs)} | ${cell(page.testEvidence)} | ${page.untestedCapabilityIds.length} | ${page.issues.length} | ${page.evidenceGaps.length} |`)
  }
  lines.push('', '## 审计解释', '', '- `missing`：保留菜单页面没有 capability；动作线索需要逐项补齐。', '- `partial`：已有接线，但契约、文档或逐 capability 测试仍有缺口。', '- `registered-unverified`：已有能力、契约、文档和测试命中，但动作完整性与真实环境行为仍未核验。', '- `evidenceGaps` 是证据状态，不与结构 `issues` 混用；尤其 `functional-coverage-unverified` 不能被解读为已完成。', '- `routeEvidence` 会跟随页面源码中的本地相对跳转，并补充同页目录下可识别的 `[mode]`、`[id]`、`detail`、`action` 等隐藏路由；动态/别名跳转无法解析时保留 `unresolvedLocalRoutes`。', '- `dependencies[].java` 只做 Java 源码字面量/稳定后缀静态核对；`unresolved`、`missing`、`unavailable` 都是待补证据，不等价于运行时 404。', '- `testEvidence` 仅为兼容字段；逐 capability 的命中情况以 `testEvidenceByCapability`、`testedCapabilityIds`、`untestedCapabilityIds` 为准。', '- `external`：菜单树保留但由 Portal iframe 承载，不作为 SDK 可调用页面。', '- 流程表单/办理页是保留人力菜单的隐藏依赖，列入 `dependencyOnlyCapabilityIds`，不把它们误报成范围外业务入口。', '- 范围外 capability 候选只按 dashboard 菜单路径列出；公共基础能力等非菜单依赖必须由依赖矩阵另行证明。', '')
  return lines.join('\n')
}

async function main () {
  for (const file of [SCOPE_FILE, CATALOG_FILE]) if (!fs.existsSync(file)) fail(`缺少 ${relative(file)}，请先运行 pnpm docs 或 pnpm build`)
  if (!fs.existsSync(PORTAL_REPO)) fail(`找不到 Portal 源码：${PORTAL_REPO}`)
  const scope = readJson(SCOPE_FILE)
  const catalog = readJson(CATALOG_FILE)
  const buildGate = inspectBuildFreshness()
  let sdkModule
  if (buildGate.status === 'fresh') {
    sdkModule = await import(pathToFileURL(DIST_FILE).href)
  } else {
    try {
      const { loadSourceModule } = await import('./http-instance-resolver.mjs')
      sdkModule = await loadSourceModule(path.join(ROOT, 'src/index.ts'))
    } catch (error) {
      if (buildGate.status === 'missing') fail(`构建门禁 missing：找不到 dist，当前 src 也无法直接加载：${error.message}`)
      process.stderr.write(`[scope-audit] 构建门禁 stale：当前 src 无法直接加载（${error.message}），仅为生成带 build-stale structural issue 的审计而显式使用旧 dist。\n`)
      sdkModule = await import(pathToFileURL(DIST_FILE).href)
    }
  }
  const { createPortalHeadless } = sdkModule
  const sdk = createPortalHeadless({ baseUrl: 'https://scope-audit.invalid', credential: { token: 'scope-audit-placeholder', tenantId: 1 } })
  const audit = buildAudit({ scope, catalog, sdk, buildGate })
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(audit, null, 2) + '\n')
  fs.writeFileSync(DOC_FILE, renderMarkdown(audit))
  process.stdout.write(`[scope-audit] ${audit.summary.retainedCallablePages} pages; ${audit.summary.withCapability} attached; ${audit.summary.structuralIssueCount} structural issues; ${audit.summary.newStructuralIssueCount} new; ${audit.summary.actionGapCount} action gaps; ${audit.summary.evidenceGapCount} evidence gaps\n`)
  if (process.argv.includes('--check') && audit.summary.issueCount > 0) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.exitCode = 2 })
}

export { buildAudit, catalogContentHash, extractActionHints, extractLiteralEndpoints, inspectBuildFreshness, sourceSupportsEndpoint, extractLocalRouteReferences, resolveLocalRouteFile }
