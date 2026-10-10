#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, relative, sep } from 'node:path'
import ts from 'typescript'
import { permissionSourceFiles, permissionSourceRevision } from '../../dist/permissions/source.js'
import { permissionCapabilityRegistry } from '../../dist/permissions/registry.js'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => value.startsWith('--') ? (pairs.push([value.slice(2), values[index + 1] ?? '']), pairs) : pairs, []))
const root = resolve(args.root ?? process.env.PORTAL_REPO ?? '')
if ((!args.root && !process.env.PORTAL_REPO) || !existsSync(root)) throw new Error('scan requires --root or PORTAL_REPO')
const out = args.out ?? 'generated/permission-candidates.ndjson'
const keywords = ['permissionCheck', 'buttonPermissionFlag', 'meta.permission', 'shopAdminPermission', 'permission:', 'v-permission', 'hasPermission', 'permissions']
const files = permissionSourceFiles(root)
const sourceSet = new Set(files)
const revision = permissionSourceRevision(root)
if (args.revision && args.revision !== revision) throw new Error('--revision must match the current source content hash')
const aliases = { 'app/': 'app/', 'common/': 'common/', 'utils/': 'utils/', 'composables/': 'composables/', 'playground/': 'playground/', 'page/': 'page/', ...(args.aliases ? JSON.parse(readFileSync(args.aliases, 'utf8')) : {}) }
const packages = new Set()
for (const file of ['package.json']) if (existsSync(join(root, file))) {
  const pkg = JSON.parse(readFileSync(join(root, file), 'utf8'))
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) packages.add(name)
}
const observations = new Map()
function inspect(file) {
  if (observations.has(file)) return observations.get(file)
  const source = readFileSync(join(root, file), 'utf8')
  // Preserve character offsets and lines when extracting all Vue script blocks.
  let code = source
  if (file.endsWith('.vue') && /<script\b/.test(source)) {
    code = source.replace(/[^\n\r]/g, ' ')
    const chars = [...code]
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      const offset = match.index + match[0].indexOf('>') + 1
      for (let i = 0; i < match[1].length; i++) chars[offset + i] = match[1][i]
    }
    code = chars.join('')
  }
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const endpointRefs = []; const imports = []; const unresolved = []; const keywordHits = []
  const line = node => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
  const constants = new Map()
  const staticValue = (node, seen = new Set()) => {
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) return staticValue(constants.get(node.text), new Set([...seen, node.text]))
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { const left = staticValue(node.left, seen); const right = staticValue(node.right, seen); return left === null || right === null ? null : left + right }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text
      for (const span of node.templateSpans) { const text = staticValue(span.expression, seen); if (text === null) return null; value += text + span.literal.text }
      return value
    }
    return null
  }
  const collect = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer); ts.forEachChild(node, collect) }
  collect(tree)
  const unresolvedAt = (node, kind, expression) => unresolved.push({ file, line: line(node), kind, expression })
  const endpoint = (node, method, url) => {
    const path = staticValue(url)
    if (path !== null && path.startsWith('/') && ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) endpointRefs.push({ method, path, sourceFile: file, line: line(node) })
    else unresolvedAt(node, 'endpoint', url?.getText(tree) ?? node.getText(tree))
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push({ specifier: staticValue(node.moduleSpecifier), line: line(node) })
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree)
      if (['import', 'require'].includes(expression)) {
        const specifier = staticValue(node.arguments[0])
        if (specifier === null) unresolvedAt(node, 'import', node.getText(tree))
        else imports.push({ specifier, line: line(node) })
      }
      const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text.toLowerCase() : ts.isElementAccessExpression(node.expression) ? (staticValue(node.expression.argumentExpression) ?? '').toLowerCase() : ''
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) endpoint(node, method, node.arguments[0])
      else if (/http|request|axios/i.test(expression)) {
        const config = node.arguments[0]
        if (config && ts.isObjectLiteralExpression(config)) {
          const properties = new Map(config.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText(tree).replace(/['"]/g, ''), property.initializer]))
          if (properties.has('url')) endpoint(node, (staticValue(properties.get('method')) ?? 'get').toLowerCase(), properties.get('url'))
          else unresolvedAt(node, 'endpoint', config.getText(tree))
        } else if (config) unresolvedAt(node, 'endpoint', config.getText(tree))
      }
    }
    if (ts.isPropertyAssignment(node) && /(?:URL|Url)$/.test(node.name.getText(tree))) unresolvedAt(node, 'declarative-endpoint', node.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  source.split(/\r?\n/).forEach((text, index) => { for (const keyword of keywords) if (keyword === 'permission:' ? /\bpermission\s*:/.test(text) : text.includes(keyword)) keywordHits.push({ file, line: index + 1, keyword, snippet: text.trim() }) })
  const observation = { endpointRefs, imports, unresolved, keywordHits }
  observations.set(file, observation)
  return observation
}
function resolveImport(current, specifier) {
  if (typeof specifier !== 'string') return null
  let base
  if (specifier.startsWith('.')) base = resolve(root, dirname(current), specifier)
  else {
    const alias = Object.keys(aliases).sort((a, b) => b.length - a.length).find(prefix => specifier.startsWith(prefix))
    if (!alias) return null
    base = resolve(root, aliases[alias], specifier.slice(alias.length))
  }
  return [base, ...['.js', '.jsx', '.ts', '.tsx', '.vue'].map(ext => base + ext), ...['index.js', 'index.ts', 'index.vue'].map(name => join(base, name))]
    .map(path => relative(root, path).split(sep).join('/')).find(path => sourceSet.has(path)) ?? null
}
function routeFor(pagePath) {
  const body = pagePath.replace(/^\/dashboard\//, '')
  const bases = pagePath.startsWith('/dashboard/') ? ['', 'hr/', 'education/', 'common/'].map(prefix => `app/portal/views/dashboard/${prefix}${body}`) : [`app/portal/views${pagePath}`]
  const matches = bases.flatMap(base => [base + '.vue', base + '/index.vue', base + '.jsx']).filter(file => sourceSet.has(file))
  return { file: matches[0] ?? null, ambiguous: matches.length > 1 }
}
const registry = permissionCapabilityRegistry()
const groups = new Map()
for (const cap of registry) { if (!groups.has(cap.pagePath)) groups.set(cap.pagePath, []); groups.get(cap.pagePath).push(cap.id) }
const output = []
for (const [pagePath, capabilityIds] of groups) {
  const route = routeFor(pagePath)
  const seeds = new Set()
  const unresolved = []
  if (!route.file || route.ambiguous) unresolved.push({ file: route.file ?? '', line: 1, kind: 'route', expression: route.ambiguous ? `ambiguous route ${pagePath}` : `route not found ${pagePath}` })
  if (route.file) {
    const module = dirname(route.file)
    // Include sibling actions, component/composable modules and parent route layouts.
    for (const file of files) if (file.startsWith(module + '/')) seeds.add(file)
    seeds.add(route.file)
    let parent = module
    while (parent.startsWith('app/portal/views')) {
      for (const file of [parent + '.vue', parent + '/index.vue', parent + '/route.ts', parent + '/route.js']) if (sourceSet.has(file)) seeds.add(file)
      parent = dirname(parent)
    }
    // Global route guards and auto-imported permission helpers are additional evidence, not conclusions.
    for (const file of files) if (/^(utils\/router\/|app\/portal\/utils\/router\/|app\/portal\/.*(?:router|route)\.[jt]s$)/.test(file) || /(?:permission|Permission)/.test(file)) seeds.add(file)
    if (sourceSet.has('vite.config.js')) seeds.add('vite.config.js')
  }
  const seen = new Set(seeds); const queue = [...seeds]; const importTrail = []
  const endpointRefs = []; const keywordHits = []
  while (queue.length) {
    const file = queue.shift(); const observation = inspect(file)
    endpointRefs.push(...observation.endpointRefs); keywordHits.push(...observation.keywordHits); unresolved.push(...observation.unresolved)
    for (const ref of observation.imports) {
      const resolved = resolveImport(file, ref.specifier)
      if (resolved) { if (!seen.has(resolved)) { seen.add(resolved); importTrail.push(resolved); queue.push(resolved) } }
      else if (!packages.has(ref.specifier?.split('/').slice(0, ref.specifier.startsWith('@') ? 2 : 1).join('/'))) unresolved.push({ file, line: ref.line, kind: 'import', expression: ref.specifier ?? 'dynamic import' })
    }
  }
  output.push({ candidateId: `candidate:${pagePath || 'unmapped'}`, pagePath, routeFile: route.file, actionFiles: [...seeds].sort(), capabilityIds, endpointRefs, keywordHits, importTrail: importTrail.sort(), unresolved, sourceRevision: revision })
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, output.map(row => JSON.stringify(row)).join('\n') + '\n')
// Independent build input: the runtime never pins itself to a policy-supplied revision.
writeFileSync(args.manifest ?? join(dirname(out), 'permission-source.json'), JSON.stringify({ schema: 'ph-permission-source/v1', sourceRevision: revision, files }) + '\n')

const linkedFiles = new Set(output.flatMap(row => [...row.actionFiles, ...row.importTrail]))
const inventory = []
for (const file of files) {
  const observation = inspect(file)
  if (observation.keywordHits.length || observation.endpointRefs.length || observation.unresolved.length) inventory.push({ file, sourceRevision: revision, linked: linkedFiles.has(file), ...observation })
}
writeFileSync(join(dirname(out), 'permission-observations.ndjson'), inventory.map(row => JSON.stringify(row)).join('\n') + '\n')
