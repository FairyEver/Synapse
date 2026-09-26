#!/usr/bin/env node
/** Read-only menu attachment audit. It deliberately cannot certify functional completeness. */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FILE = fileURLToPath(import.meta.url)
const SDK_ROOT = path.resolve(path.dirname(FILE), '../..')
const DEFAULT_PORTAL = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const ENV_KEYS = ['VITE_CRM_URL', 'VITE_FLOW_ENGINE_URL', 'VITE_PRODUCT_URL']
const digest = value => createHash('sha256').update(value).digest('hex')
const fail = message => { throw new Error(message) }
const unavailable = name => () => fail(`菜单求值意外执行浏览器/未支持操作：${name}`)

function envFromSource(root) {
  const filename = path.join(root, 'build/env/.env.build.test')
  const text = fs.readFileSync(filename, 'utf8')
  const result = { DEV: false, VITE_API_ENV_NAME: 'test' }
  for (const key of ENV_KEYS) {
    const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, 'm'))
    if (!match) fail(`测试环境源码缺少 ${key}；不会猜 iframe 地址`)
    const raw = match[1].replace(/^(['"])(.*)\1$/, '$2')
    if (!/^https?:\/\//.test(raw) || raw.includes('${')) fail(`${key} 不是已解析的 HTTP(S) 地址`)
    result[key] = raw
  }
  return { env: result, filename, hash: digest(text) }
}

function flatten(nodes, trail = []) {
  if (!Array.isArray(nodes)) fail('菜单 children/all_menus 不是数组')
  return nodes.flatMap(node => {
    if (!node || typeof node !== 'object') fail('菜单节点不是对象')
    const labels = [...trail, String(node.title ?? '')]
    if (node.children !== undefined) return flatten(node.children, labels)
    if (typeof node.path !== 'string' || !node.path.startsWith('/')) fail(`无法识别菜单路径：${labels.join(' / ')}`)
    const iframe = node.path.startsWith('/dashboard/frame?')
    if (iframe && (typeof node.permission !== 'string' || !node.permission.startsWith('/'))) fail(`iframe 没有可定位权限路径：${labels.join(' / ')}`)
    return [{ title: String(node.title ?? ''), breadcrumbs: labels, path: node.path, permission: node.permission ?? null, iframe, capabilityPath: iframe ? node.permission : node.path }]
  })
}

/** Uses native ESM parsing: comments, imported constants and conditionals retain JS semantics. */
export async function evaluatePortalMenus(portalRepo = DEFAULT_PORTAL) {
  if (!vm.SourceTextModule) {
    const child = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', FILE, '--evaluate-only', '--portal-repo', portalRepo], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })
    if (child.error) throw child.error
    if (child.status !== 0) fail(child.stderr.trim() || '菜单求值子进程失败')
    return JSON.parse(child.stdout)
  }
  const root = fs.realpathSync(portalRepo)
  const layoutFile = 'app/portal/components/portal/layout/index.vue'
  const layout = fs.readFileSync(path.join(root, layoutFile), 'utf8')
  // This intentionally fails when the source changes its grouping rule, instead of silently
  // continuing with our previous interpretation of the system selector.
  if (!/active\s*===\s*SYSTEM_COMMON_VALUE/.test(layout)
    || !/menus\.value\.filter\(\s*menu\s*=>\s*!menu\.system\s*\)/.test(layout)
    || !/menus\.value\.filter\(\s*menu\s*=>\s*menu\.system\s*===\s*active\s*\)/.test(layout)) {
    fail('系统选择器源码规则已变化，无法可靠复用顶层 system 分组；需人工复核')
  }
  const environment = envFromSource(root)
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
  const modules = new Map()
  const sourceHashes = { [layoutFile]: digest(layout), [path.relative(root, environment.filename)]: environment.hash }
  let id = 0
  const clone = value => {
    if (Array.isArray(value)) return value.map(clone)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
    if (typeof value === 'function') fail('菜单树出现函数值，不能按普通对象克隆')
    return value
  }
  const adapters = {
    // The menu source imports the palette through `define.js`, but palette generation is
    // visual-only and has no bearing on menu membership. Keep the real palette module in
    // the source hash while stubbing Ant Design's generator so this read-only evaluator
    // does not execute unrelated package code.
    '@ant-design/colors': { generate: seed => Array.from({ length: 10 }, (_, index) => `${seed}:${index}`) },
    'lodash-es': {
      cloneDeep: clone, isArray: Array.isArray, isPlainObject: value => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
      uniq: values => [...new Set(values)],
      find: (values, predicate) => Object.values(values).find(predicate),
      mapKeys: (values, fn) => Object.fromEntries(Object.entries(values).map(([key, value]) => [fn(value, key), value])),
      mapValues: (values, fn) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fn(value, key)])),
    },
    'nanoid': { nanoid: () => `audit-${++id}`, customAlphabet: () => () => `audit-${++id}` },
    'js-base64': { encode: value => Buffer.from(value, 'utf8').toString('base64'), decode: value => Buffer.from(value, 'base64').toString('utf8') },
    'qs': { default: { parse: unavailable('qs.parse') } },
    'app/portal/utils/system.js': { usePermissionStore: unavailable('usePermissionStore') },
    'app/portal/utils/storage.js': { cookie: { get: unavailable('cookie.get'), set: unavailable('cookie.set'), remove: unavailable('cookie.remove') } },
    'common/utils/url.js': { getRouteFullPath: unavailable('getRouteFullPath') },
  }
  const allowedFiles = new Set([
    'app/portal/utils/define.js', 'app/portal/utils/menu.js',
    'common/utils/system-color-palette.js',
    'common/components/common/layout/dashboard/sidebar/define.js', 'common/utils/array.js', 'common/utils/string.js',
  ])
  function getModule(specifier, parent) {
    if (Object.hasOwn(adapters, specifier)) {
      if (!modules.has(specifier)) {
        const values = adapters[specifier]
        modules.set(specifier, new vm.SyntheticModule(Object.keys(values), function () {
          for (const [name, value] of Object.entries(values)) this.setExport(name, value)
        }, { context, identifier: specifier }))
      }
      return modules.get(specifier)
    }
    let filename = specifier.startsWith('.') ? path.resolve(path.dirname(parent), specifier) : path.join(root, specifier)
    if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      filename = fs.existsSync(`${filename}.js`) ? `${filename}.js` : path.join(filename, 'index.js')
    }
    if (!fs.existsSync(filename)) fail(`菜单依赖不存在：${specifier}（来自 ${parent}）`)
    filename = fs.realpathSync(filename)
    const relative = path.relative(root, filename).split(path.sep).join('/')
    if (!relative.startsWith('app/portal/menus/') && !allowedFiles.has(relative)) fail(`未支持的菜单依赖：${relative}`)
    if (modules.has(filename)) return modules.get(filename)
    const source = fs.readFileSync(filename, 'utf8')
    sourceHashes[relative] = digest(source)
    const module = new vm.SourceTextModule(source, {
      context, identifier: filename,
      initializeImportMeta(meta) {
        meta.env = new Proxy(environment.env, { get(target, property) {
          if (typeof property !== 'string' || !Object.hasOwn(target, property)) fail(`菜单使用未登记环境变量：${String(property)}`)
          return target[property]
        } })
      },
      importModuleDynamically: unavailable('dynamic import'),
    })
    modules.set(filename, module)
    return module
  }
  const entry = getModule('app/portal/menus/index.js', root)
  await entry.link((specifier, parent) => getModule(specifier, parent.identifier))
  await entry.evaluate({ timeout: 2_000 })
  const constants = getModule('app/portal/utils/define.js', root).namespace
  for (const key of ['SYSTEM_HR_VALUE', 'SYSTEM_PLATFORM_VALUE', 'SYSTEM_COMMON_VALUE']) {
    if (typeof constants[key] !== 'number') fail(`系统常量不是数值：${key}`)
  }
  const roots = entry.namespace.all_menus
  if (!Array.isArray(roots)) fail('index.js 未导出 all_menus 数组')
  const systems = [
    { key: 'hr', title: '人力', roots: roots.filter(node => node.system === constants.SYSTEM_HR_VALUE) },
    { key: 'platform', title: '平台', roots: roots.filter(node => node.system === constants.SYSTEM_PLATFORM_VALUE) },
    { key: 'portal', title: '门户', roots: roots.filter(node => !node.system) },
  ].map(({ key, title, roots: selected }) => ({ key, title, leaves: flatten(selected) }))
  if (systems.some(system => system.leaves.length === 0)) fail('至少一个目标系统没有活跃叶子；拒绝发布可能缩小分母的报告')
  let revision = null
  try { revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* fixtures need not be Git repos */ }
  return { portalRepo: root, revision, environment: 'test', sourceHashes, adapters: Object.keys(adapters), systems }
}

export function buildCoverage(menuAudit, capabilities, describe) {
  if (!Array.isArray(capabilities)) fail('SDK 未提供注册能力数组')
  const definitions = new Map()
  for (const cap of capabilities) {
    if (!cap.id || !cap.pagePath || definitions.has(cap.id)) fail(`无效或重复能力登记：${cap.id}`)
    definitions.set(cap.id, cap)
  }
  const systems = menuAudit.systems.map(system => {
    const leaves = system.leaves.map(leaf => {
      const registered = capabilities.filter(cap => cap.pagePath === leaf.capabilityPath).map(cap => {
        const description = describe(cap.id)
        if (!description?.ok) fail(`已登记能力无法 describe：${cap.id}`)
        return { id: cap.id, title: cap.title, write: cap.write, ai: description.ai ? 'present' : 'missing', aiGaps: description.ai?.gaps ?? [] }
      })
      return { ...leaf, capabilities: registered, functionalCoverage: 'unknown', browserVerification: 'unknown' }
    })
    const attached = leaves.filter(leaf => leaf.capabilities.length > 0)
    const ids = [...new Set(attached.flatMap(leaf => leaf.capabilities.map(cap => cap.id)))]
    return {
      key: system.key, title: system.title, activeLeaves: leaves.length, attachedLeaves: attached.length,
      pageAttachmentRate: leaves.length ? attached.length / leaves.length : null,
      registeredCapabilityCount: ids.length, registeredCapabilityIds: ids,
      zeroCapabilityLeaves: leaves.filter(leaf => leaf.capabilities.length === 0).map(leaf => ({ title: leaf.title, path: leaf.path, capabilityPath: leaf.capabilityPath })),
      explicitAiGaps: attached.flatMap(leaf => leaf.capabilities.filter(cap => cap.aiGaps.length > 0).map(cap => ({ capabilityId: cap.id, path: leaf.capabilityPath, gaps: cap.aiGaps }))),
      missingAiDescriptions: [...new Set(attached.flatMap(leaf => leaf.capabilities.filter(cap => cap.ai === 'missing').map(cap => cap.id)))],
      functionalCoverage: 'unknown', browserVerification: 'unknown', leaves,
    }
  })
  return {
    title: '人力 / 平台 / 门户 PC 页面挂载率',
    metric: 'page-attachment-rate', source: { ...menuAudit, systems: undefined },
    totalRegisteredCapabilities: capabilities.length, systems,
    functionalCoverage: 'unknown', actionInventory: 'unknown', browserVerification: 'unknown',
    limitations: [
      '一个页面有能力只代表挂载；没有穷尽按钮、详情、弹窗、导入导出及外壳非菜单动作。',
      '静态菜单未按某用户权限裁剪；无浏览器基准或本次线上读写/撤销实测。',
      '只报告 describe 实际返回的明确 AI gaps；无 gaps 不等于业务说明完整或业务已验证。',
      '使用当前 dist，请先 pnpm build；源码/构建内容哈希用于定位，不能用时间戳声称构建新鲜。',
    ],
  }
}

export function coverageCheckPassed(report) {
  return report.functionalCoverage === 'verified' && report.actionInventory === 'complete' && report.browserVerification === 'verified'
    && report.systems.every(system => system.zeroCapabilityLeaves.length === 0 && system.explicitAiGaps.length === 0 && system.missingAiDescriptions.length === 0)
}

function render(report) {
  const lines = [report.title, '（不是功能完成率；动作清单与浏览器验证：unknown）', '']
  for (const system of report.systems) {
    lines.push(`${system.title}：${system.attachedLeaves}/${system.activeLeaves} 页面挂载（${(system.pageAttachmentRate * 100).toFixed(1)}%）；注册能力 ${system.registeredCapabilityCount}；零能力页 ${system.zeroCapabilityLeaves.length}；明确 AI 缺口 ${system.explicitAiGaps.length}；说明缺失 ${system.missingAiDescriptions.length}`)
    for (const leaf of system.zeroCapabilityLeaves) lines.push(`  未挂载：${leaf.title} ${leaf.capabilityPath}`)
    for (const gap of system.explicitAiGaps) lines.push(`  AI gap：${gap.capabilityId} ${gap.gaps.join('；')}`)
  }
  lines.push('', ...report.limitations)
  return lines.join('\n') + '\n'
}

async function main(args) {
  const options = { json: false, check: false, evaluateOnly: false, portalRepo: process.env.PORTAL_REPO || DEFAULT_PORTAL, sdkRoot: SDK_ROOT }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') options.json = true
    else if (arg === '--check') options.check = true
    else if (arg === '--evaluate-only') options.evaluateOnly = true
    else if (arg === '--portal-repo' || arg === '--sdk-root') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`${arg} 需要目录路径`)
      options[arg === '--portal-repo' ? 'portalRepo' : 'sdkRoot'] = path.resolve(args[++i])
    } else if (arg === '--help') {
      process.stdout.write('用法：pnpm build && node tools/generate/pc-coverage.mjs [--json] [--check] [--portal-repo PATH]\n只读测试环境菜单与当前 dist；--check 在存在缺口或功能验证 unknown 时退出 1。不会拉代码或生成文件。\n')
      return
    } else fail(`未知参数：${arg}`)
  }
  const menus = await evaluatePortalMenus(options.portalRepo)
  if (options.evaluateOnly) { process.stdout.write(JSON.stringify(menus)); return }
  const entry = path.join(options.sdkRoot, 'dist/index.js')
  if (!fs.existsSync(entry)) fail('缺少 dist/index.js，请先 pnpm build')
  const { createPortalHeadless } = await import(pathToFileURL(entry).href)
  if (typeof createPortalHeadless !== 'function') fail('SDK 构建缺少 createPortalHeadless')
  const sdk = createPortalHeadless({ baseUrl: 'https://pc-coverage.invalid', credential: { token: 'inert-audit-placeholder', tenantId: 1 } })
  const report = buildCoverage(menus, sdk.capabilities, id => sdk.catalog.describe(id))
  report.source.sdkEntryHash = digest(fs.readFileSync(entry))
  process.stdout.write(options.json ? JSON.stringify(report, null, 2) + '\n' : render(report))
  if (options.check && !coverageCheckPassed(report)) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === FILE) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`[pc-coverage] ${error.message}\n`); process.exitCode = 2 })
}
