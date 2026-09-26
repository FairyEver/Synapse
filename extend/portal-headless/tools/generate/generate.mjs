#!/usr/bin/env node
/**
 * 从 Portal 前端源码（CodeReview_Projects_Js @ test/portal/main）生成 SDK 需要的静态资产。
 *
 * 产出（写入 ./generated/，构建时烘入 SDK —— 设计 D13 / D18）：
 *   module-type-rules.json  页面路径 -> module-type 的规则表
 *   page-catalog.json       页面唯一参考清单（待办列表，设计 D24）
 *
 * 用法：
 *   node tools/generate/generate.mjs [Portal 仓库路径]
 *   默认读取 PORTAL_REPO 环境变量，否则用下面的 DEFAULT_PORTAL_REPO。
 *
 * 只读：本脚本不修改 Portal 仓库的任何文件。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const OUT_DIR = path.join(PKG_ROOT, 'generated')
const SCOPE_DOC_OUT = path.join(PKG_ROOT, 'docs/portal-scope.md')

const DEFAULT_PORTAL_REPO = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const PORTAL_REPO = path.resolve(process.argv[2] || process.env.PORTAL_REPO || DEFAULT_PORTAL_REPO)

const MENUS_DIR = path.join(PORTAL_REPO, 'app/portal/menus')
const VIEWS_DIR = path.join(PORTAL_REPO, 'app/portal/views')
const DEFINE_FILE = path.join(PORTAL_REPO, 'app/portal/utils/define.js')
const MENUS_INDEX = path.join(MENUS_DIR, 'index.js')

function die (message) {
  process.stderr.write(`[generate] ${message}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. module-type 常量表（app/portal/utils/define.js）
// ---------------------------------------------------------------------------
function readModuleTypeConstants () {
  const src = fs.readFileSync(DEFINE_FILE, 'utf8')
  const table = {}
  for (const m of src.matchAll(/export const (SYSTEM_MODULE_TYPE_\w+)\s*=\s*\{\s*label:\s*'([^']*)'\s*,\s*value:\s*(\d+)/g)) {
    table[m[1]] = { label: m[2], value: Number(m[3]) }
  }
  return table
}

// ---------------------------------------------------------------------------
// 2. 菜单文件清单与变量归属
// ---------------------------------------------------------------------------
function collectMenuFiles (dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectMenuFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * 把源码里的注释**原地抹成空格**，行数与行号一个不变。
 *
 * 为什么需要它：菜单文件里被注释掉的菜单项**不是菜单项**（`hr.js` 里就有
 * `// { path: '/dashboard/course/live-course/list', … }` 这种），而下面的抽取是逐行正则、
 * 本来会把它们当成真的收进清单。用户 2026-09-21 把这条定成了项目规则：
 * **Portal 里已经注释掉的代码 = 已经没有意义的东西，不要搬进 SDK**（见 docs/conventions.md）。
 *
 * 为什么是"抹成空格"而不是"删掉这些行"：iframe 分支的 id 是
 * `sha1(相对路径#lineIndex#标签)`，**行号是哈希的一部分**。删行会让后面所有 iframe 的 id 漂移。
 *
 * 处理 `//` 行注释与 `/* … *​/` 块注释（块注释可以跨行，所以状态要在行之间带着走），
 * 并且**认字符串**——`'https://x'` 里的 `//` 不是注释。正则字面量不处理：菜单文件里没出现过。
 */
function blankComments (lines) {
  let inBlock = false
  return lines.map((line) => {
    let out = ''
    let inString = null
    let escaped = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inBlock) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlock = false
          out += '  '
          i += 1
        } else {
          out += ' '
        }
        continue
      }
      if (escaped) {
        escaped = false
        out += ch
        continue
      }
      if (inString) {
        if (ch === '\\') escaped = true
        else if (ch === inString) inString = null
        out += ch
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch
        out += ch
        continue
      }
      if (ch === '/' && line[i + 1] === '/') {
        out += ' '.repeat(line.length - i)
        break
      }
      if (ch === '/' && line[i + 1] === '*') {
        inBlock = true
        out += '  '
        i += 1
        continue
      }
      out += ch
    }
    return out
  })
}

/** 按对象读取菜单字段；子对象独立处理，避免换行漏字段或拿到子菜单的权限。 */
export function readMenuEntries (source) {
  const src = blankComments(source.split('\n')).join('\n')
  const stack = []
  const entries = []
  let quote = null
  let escaped = false
  let lineIndex = 0
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    const current = stack.at(-1)
    if (quote) {
      if (current) current.text += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      if (current) current.text += ch
    } else if (ch === '{') {
      // 留一个分隔符，不能把嵌套对象两侧的 token 拼起来。
      if (current) current.text += ' '
      stack.push({ text: '', lineIndex, offset: i })
    } else if (ch === '}') {
      if (current) entries.push(stack.pop())
    } else if (current) {
      current.text += ch
    }
    if (ch === '\n') lineIndex += 1
  }
  return entries
    .filter((entry) => /\bpath\s*:/.test(entry.text))
    .sort((a, b) => a.offset - b.offset)
}

function buildVariableToFileMap (menuFiles) {
  const map = {}
  for (const file of menuFiles) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=/g)) {
      map[m[1]] = file
    }
  }
  // index.js 里的 import 别名（all_menus as sale_menus）也要映射到被导入的文件
  const indexSrc = fs.readFileSync(MENUS_INDEX, 'utf8')
  for (const m of indexSrc.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'(\.[^']+)'/g)) {
    const target = m[2].replace(/\.js$/, '').replace(/^\.\//, '')
    const candidates = [target + '.js', path.join(target, 'index.js')]
    const resolved = candidates.map((c) => path.join(MENUS_DIR, c)).find((c) => fs.existsSync(c))
    if (!resolved) continue
    for (const one of m[1].split(',')) {
      const alias = one.match(/(\w+)\s+as\s+(\w+)/)
      if (alias) map[alias[2]] = resolved
    }
  }
  return map
}

/** 抽某个菜单文件里的全部菜单路径（用于把 findTree 形式的规则展开成显式路径集） */
function readPathsFromMenuFile (file) {
  const src = fs.readFileSync(file, 'utf8')
  const paths = new Set()
  for (const line of src.split('\n')) {
    const m = line.match(/path\s*:\s*'([^']+)'/)
    if (!m) continue
    if (!m[1].startsWith('/')) continue
    if (m[1].startsWith('/dashboard/frame')) continue
    paths.add(m[1].split('?')[0])
  }
  return [...paths]
}

// ---------------------------------------------------------------------------
// 3. 抽取 all_menus_type_match
// ---------------------------------------------------------------------------
function extractModuleTypeRules () {
  const consts = readModuleTypeConstants()
  const indexSrc = fs.readFileSync(MENUS_INDEX, 'utf8')
  const from = indexSrc.indexOf('export const all_menus_type_match')
  const to = indexSrc.indexOf('\nexport const COOKIE_MENU_PATH_KEY')
  if (from === -1 || to === -1) die('在 menus/index.js 里找不到 all_menus_type_match')

  const block = indexSrc.slice(from, to)
  const varToFile = buildVariableToFileMap(collectMenuFiles(MENUS_DIR))
  const rules = []

  for (const part of block.split(/(?=type:\s*SYSTEM_MODULE_TYPE_\w+\.value)/).slice(1)) {
    const constName = (part.match(/type:\s*(SYSTEM_MODULE_TYPE_\w+)\.value/) || [])[1]
    if (!constName) continue
    const info = consts[constName] || { label: constName, value: null }
    if (info.value === null) continue

    const arrayIndex = part.indexOf('const rules = [')
    if (arrayIndex !== -1) {
      const arrayText = part.slice(arrayIndex, part.indexOf(']', arrayIndex))
      const prefixes = [...arrayText.matchAll(/'([^']+)'/g)].map((m) => m[1])
      if (prefixes.length) {
        rules.push({ type: info.value, label: info.label, kind: 'prefix', prefixes })
        continue
      }
    }

    // 另一种形式：findTree(<菜单变量>, e => e.path === data.menuEntryPath)
    // 它是「成员精确匹配」，这里展开成显式路径集，SDK 运行时才好判。
    // 近似点：取该变量所属菜单文件里的全部路径（同一文件通常只服务一个业务域）。
    const treeVars = [...part.matchAll(/findTree\(\s*(\w+)/g)].map((m) => m[1])
    if (treeVars.length) {
      const paths = new Set()
      for (const v of treeVars) {
        const file = varToFile[v]
        if (!file) continue
        for (const p of readPathsFromMenuFile(file)) paths.add(p)
      }
      if (paths.size) {
        rules.push({ type: info.value, label: info.label, kind: 'paths', paths: [...paths].sort() })
      }
    }
  }

  return rules
}

// ---------------------------------------------------------------------------
// 4. 页面清单（待办列表）
// ---------------------------------------------------------------------------
const DROPPED_SEGMENTS = ['hr', 'education', 'common']

function resolveRouteFile (menuPath) {
  const body = menuPath.replace(/^\/dashboard\//, '')
  const bases = [path.join(VIEWS_DIR, 'dashboard', body)]
  for (const segment of DROPPED_SEGMENTS) bases.push(path.join(VIEWS_DIR, 'dashboard', segment, body))
  if (menuPath.startsWith('/simple/')) bases.push(path.join(VIEWS_DIR, menuPath.replace(/^\//, '')))
  for (const base of bases) {
    for (const candidate of [base + '.vue', base + '/index.vue', base + '.jsx']) {
      if (fs.existsSync(candidate)) return path.relative(PORTAL_REPO, candidate)
    }
  }
  return null
}

function classifyPage (file, src) {
  if (file.includes('/views/simple/')) return '声明式流程表单(simple)'
  if (file.includes('/dashboard/frame')) return 'iframe 嵌入外部系统'
  const list = src.includes('useListPageModule')
  const form = src.includes('useFormPageModule')
  if (list && src.includes('customLoad')) return '列表页(自定义 customLoad)'
  if (list) return '列表页(声明式 getDataListURL)'
  if (form && src.includes('customSubmit')) return '表单页(自定义 customSubmit)'
  if (form) return '表单页(声明式 objectURL)'
  if (src.includes('useFlowForm') || src.includes('flow-form')) return '流程表单(useFlowForm)'
  return '其他/自定义页面'
}

function buildPageCatalog (rules) {
  const items = []
  const seen = new Set()
  const constants = readStringConstants()
  const menuFiles = collectMenuFiles(MENUS_DIR).sort((left, right) => {
    const priority = (file) => path.basename(file) === 'mall.v2.js' ? 0 : path.basename(file) === 'mall.js' ? 1 : 2
    return priority(left) - priority(right) || left.localeCompare(right)
  })

  for (const file of menuFiles) {
    const rel = path.relative(PORTAL_REPO, file)
    for (const { lineIndex, text: line } of readMenuEntries(fs.readFileSync(file, 'utf8'))) {
      if (/\bpath\s*:\s*iframeLinkGenerator\w*\s*\(/.test(line)) {
        const title = line.match(/title:\s*'([^']*)'/)
        const permission = line.match(/permission:\s*'([^']*)'/)
        const label = title ? title[1] : '(未命名 iframe)'
        items.push({
          // 行号要进哈希：同一文件里两个同名 iframe 否则会撞成同一个 id
          id: 'iframe-' + crypto.createHash('sha1').update(`${rel}#${lineIndex}#${label}`).digest('hex').slice(0, 6),
          menuPath: null,
          title: label,
          domain: '(iframe)',
          permission: permission ? permission[1] : '',
          routeFile: null,
          kind: 'iframe 嵌入外部系统',
          write: null,
          menuSource: rel,
          status: '待处理',
        })
        continue
      }

      const pathMatch = line.match(/path\s*:\s*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[A-Za-z_$][\w$]*)/)
      if (!pathMatch) continue
      const decodedPath = decodeStringExpression(pathMatch[1], constants)
      if (!decodedPath.startsWith('/')) continue
      if (decodedPath.startsWith('/dashboard/frame')) continue

      const menuPath = decodedPath.split('?')[0]
      if (seen.has(menuPath)) continue
      seen.add(menuPath)

      const title = line.match(/title:\s*'([^']*)'/)
      const permission = line.match(/permission:\s*'([^']*)'/)
      const routeFile = resolveRouteFile(menuPath)
      let kind = '(未解析)'
      let write = null
      if (routeFile) {
        const src = fs.readFileSync(path.join(PORTAL_REPO, routeFile), 'utf8')
        kind = classifyPage(routeFile, src)
        // `write` =「该页面**看得出**有写操作」，不是「该页面有写操作」。它只认
        // `http.post/put/delete(` 这一种写法，**两个方向都会错**，改判据前先读这段：
        //
        // - 漏判：GET 写。实测 2026-09-20 逐个读调用点确认，`write:false` 的 596 页里有
        //   **17 页**是 GET 写：`/org/hrAttendanceSheet/unArchiveSheet` 与 `archiveSheet`
        //   （二次确认后取消归档 / 归档）、`/manage/deleteTeacherLevel.lay`、
        //   `/manage/updateProfessor.lay`、`/admin-api/finance/{accounting-period,credit-management,
        //   receiving-account-number}/enableOrStop`、`/sys/categoryCat/delete`（写在
        //   `customDelete` 里）、`/advanceduser/*Delete*`、`/diseaseReport/updateDel`、
        //   `/vet/deleteVet` 等。它们与 GET 读在源码里长得一样。
        // - 误判：后端用 POST 收查询体。实测 365 个标为 `write:true` 的页里有 **73 页**，
        //   其 post/put/delete 的**字面量** URL 全是读形状（`/page`、`/query`、`/export*`、
        //   `getXxx`），典型是 `customLoad` 里 `http.post('.../page', form)`——那是**列表读**，
        //   页面里一处写都没有。
        //
        // 结论：**两个方向都会错，所以它不是「下界」，是一个双向有误差的启发式**。
        // 试过并否掉的两条词法规则（误判比漏判更糟：把读判成写会让 AI 以为要谨慎，
        // 把写判成读会让它随手改数据）：按 URL 末段的写动词判 GET —— 命中 `write:false`
        // 的 27 页里 10 页是假（`create-list`、`archiveUpdatePage`、`asset-transfer-detail`、
        // `getRoleEnableOrganizationTree`、`searchChickenListOfStart`、`getMaxSort` …）；
        // 按「`customDelete` / 写动词函数名的上下文里有 `.get()`」判 —— 真阳性更多，
        // 但同样有假。静态判不可靠，**不要**在拿到逐页 ground truth 之前堆规则，
        // 那只是把误差换个方向。
        // 另：`routeFile` 之外（页面 import 的 composable / api 模块）里的写调用这里看不到；
        // 页面里还有约 56 处 `.get()` 的 URL 不是字面量，任何词法规则都判不了。
        write = /http\s*\.\s*(post|put|delete)\s*\(/.test(src)
      }

      items.push({
        id: crypto.createHash('sha1').update(menuPath).digest('hex').slice(0, 6),
        menuPath,
        title: title ? title[1] : '',
        domain: menuPath.split('/')[2] || 'root',
        permission: permission ? permission[1] : '',
        routeFile,
        kind,
        write,
        menuSource: rel,
        status: '待处理',
      })
    }
  }

  // 用规则表标注每个页面的 module-type（含"算不出来"这一类，设计 D34）
  for (const item of items) {
    if (!item.menuPath) {
      item.moduleType = null
      item.moduleTypeLabel = ''
      continue
    }
    const matched = matchModuleType(item.menuPath, rules)
    item.moduleType = matched ? matched.type : null
    item.moduleTypeLabel = matched ? matched.label : ''
  }

  return items.sort((a, b) => (a.menuPath || '').localeCompare(b.menuPath || ''))
}

function matchModuleType (menuPath, rules) {
  const normalized = normalizeMenuEntryPath(menuPath)
  for (const rule of rules) {
    if (rule.kind === 'prefix' && rule.prefixes.some((p) => normalized.startsWith(p))) return rule
    if (rule.kind === 'paths' && rule.paths.includes(normalized)) return rule
  }
  return null
}

const DETAIL_KEYWORDS = ['create', 'edit', 'data', 'detail', 'change', 'step1', 'step2', 'step3']
function normalizeMenuEntryPath (menuPath) {
  const clean = menuPath.split('?')[0]
  if (clean.endsWith('/list')) return clean
  const segments = clean.split('/')
  const index = segments.findIndex((s) => DETAIL_KEYWORDS.includes(s))
  return index > -1 ? [...segments.slice(0, index), 'list'].join('/') : clean
}

// ---------------------------------------------------------------------------
// 6. 菜单范围模型（机器可审计的固定下发面）
// ---------------------------------------------------------------------------
const SCOPE_SOURCE_RELATIVE_FILES = [
  'app/portal/menus/index.js',
  'app/portal/menus/common.js',
  'app/portal/menus/finance.js',
  'app/portal/menus/material.js',
  'app/portal/menus/product/index.js',
  'app/portal/menus/product/operation.js',
  'app/portal/menus/sale.js',
  'app/portal/menus/supply.js',
  'app/portal/menus/technology.js',
  'app/portal/menus/hr.js',
  'app/portal/menus/mall.v2.js',
  'app/portal/utils/define.js',
]

const SCOPE_ROOT_SPECS = [
  { rootId: 'portal/智能助手', title: '智能助手', sourceSystem: 'portal', file: 'app/portal/menus/index.js', variable: 'all_menus', selector: 'index.js:all_menus -> title=智能助手' },
  { rootId: 'portal/个人用量', title: '个人用量', sourceSystem: 'portal', file: 'app/portal/menus/index.js', variable: 'all_menus', selector: 'index.js:all_menus -> title=个人用量' },
  { rootId: 'portal/待办事项', title: '待办事项', sourceSystem: 'portal', file: 'app/portal/menus/index.js', variable: 'all_menus', selector: 'index.js:all_menus -> title=待办事项' },
  { rootId: 'portal/系统设置', title: '系统设置', sourceSystem: 'portal', file: 'app/portal/menus/index.js', variable: 'all_menus', selector: 'index.js:all_menus -> title=系统设置' },
  { rootId: 'platform/人工智能', title: '人工智能', sourceSystem: 'platform', file: 'app/portal/menus/mall.v2.js', variable: 'all_menus', selector: 'mall.v2.js:all_menus -> title=人工智能 -> aiChildren' },
  { rootId: 'platform/平台设置', title: '平台设置', sourceSystem: 'platform', file: 'app/portal/menus/mall.v2.js', variable: 'all_menus', selector: 'mall.v2.js:all_menus -> title=平台设置 -> platformSettingChildren' },
  { rootId: 'hr/人力', title: '人力', sourceSystem: 'hr', file: 'app/portal/menus/hr.js', variable: 'all_menus', selector: 'hr.js:all_menus（全量）' },
]

const scopeSourceCache = new Map()

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readStringConstants () {
  const constants = {}
  const files = [DEFINE_FILE, ...SCOPE_SOURCE_RELATIVE_FILES.map((relative) => path.join(PORTAL_REPO, relative))]
  for (const file of [...new Set(files)]) {
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*(['"])(.*?)\2/gs)) {
      constants[m[1]] = m[3]
    }
  }
  return constants
}

function readObjectNodes (source) {
  const masked = blankComments(source.split('\n')).join('\n')
  const stack = []
  const objects = []
  let quote = null
  let escaped = false
  let lineIndex = 0

  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i]
    const current = stack.at(-1)
    if (quote) {
      if (current) current.direct += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      if (current) current.direct += ch
    } else if (ch === '{') {
      if (current) current.direct += ' '
      stack.push({ start: i, lineIndex, direct: '', end: -1 })
    } else if (ch === '}') {
      const closed = stack.pop()
      if (closed) {
        closed.end = i + 1
        objects.push(closed)
      }
      const parent = stack.at(-1)
      if (parent) parent.direct += ' '
    } else if (current) {
      current.direct += ch
    }
    if (ch === '\n') lineIndex += 1
  }

  return objects.sort((a, b) => a.start - b.start)
}

function readSourceFile (file) {
  const cached = scopeSourceCache.get(file)
  if (cached) return cached
  const source = fs.readFileSync(file, 'utf8')
  const parsed = {
    file,
    source,
    masked: blankComments(source.split('\n')).join('\n'),
    objects: readObjectNodes(source),
    imports: null,
  }
  scopeSourceCache.set(file, parsed)
  return parsed
}

function findMatchingDelimiter (source, start, open, close) {
  let quote = null
  let escaped = false
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function readVariableDefinition (parsed, name) {
  const re = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`, 'g')
  const match = re.exec(parsed.masked)
  if (!match) return null

  const assignmentStart = match.index + match[0].length
  const nextDeclaration = parsed.masked.slice(assignmentStart).search(/\n\s*(?:(?:export\s+)?(?:const|let|var|function)\s+)/)
  const limit = nextDeclaration === -1 ? parsed.masked.length : assignmentStart + nextDeclaration
  const arrayStart = parsed.masked.indexOf('[', assignmentStart)
  if (arrayStart === -1 || arrayStart >= limit) {
    return { name, start: match.index, assignmentStart, expression: parsed.masked.slice(assignmentStart, limit), arrayStart: -1, arrayEnd: -1 }
  }
  const arrayEnd = findMatchingDelimiter(parsed.masked, arrayStart, '[', ']')
  if (arrayEnd === -1 || arrayEnd > limit && nextDeclaration !== -1) {
    return { name, start: match.index, assignmentStart, expression: parsed.masked.slice(assignmentStart, limit), arrayStart: -1, arrayEnd: -1 }
  }
  return { name, start: match.index, assignmentStart, expression: parsed.masked.slice(assignmentStart, arrayEnd + 1), arrayStart, arrayEnd }
}

function readImports (parsed) {
  if (parsed.imports) return parsed.imports
  const imports = new Map()
  for (const m of parsed.masked.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const targetBase = m[2]
    const target = targetBase.startsWith('.')
      ? path.resolve(path.dirname(parsed.file), targetBase)
      : null
    const candidates = target
      ? [target.replace(/\.js$/, '') + '.js', path.join(target, 'index.js')]
      : []
    const resolved = candidates.find((candidate) => fs.existsSync(candidate))
    if (!resolved) continue
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      const imported = bits[0]?.trim()
      const local = bits[1]?.trim() || imported
      if (imported && local) imports.set(local, { file: resolved, name: imported })
    }
  }
  parsed.imports = imports
  return imports
}

function readFieldExpression (record, field) {
  const match = new RegExp(`(?:^|[,{\\s])${escapeRegExp(field)}\\s*:`).exec(record.direct)
  if (!match) return null
  let index = match.index + match[0].length
  while (/\s/.test(record.direct[index] || '')) index += 1
  const start = index
  const first = record.direct[index]
  if (first === "'" || first === '"' || first === '`') {
    index += 1
    let escaped = false
    for (; index < record.direct.length; index += 1) {
      const ch = record.direct[index]
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === first) return record.direct.slice(start, index + 1)
    }
  }

  let depth = 0
  let quote = null
  let escaped = false
  for (; index < record.direct.length; index += 1) {
    const ch = record.direct[index]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) break
  }
  return record.direct.slice(start, index).trim()
}

function decodeStringExpression (expression, constants) {
  if (!expression) return ''
  const first = expression[0]
  if (first !== "'" && first !== '"' && first !== '`') {
    return constants[expression.trim()] ?? ''
  }
  let value = expression.slice(1, -1).replace(/\\([\\'"`])/g, '$1')
  if (first === '`') value = value.replace(/\$\{(\w+)\}/g, (_, name) => constants[name] ?? '${' + name + '}')
  return value
}

function directTitle (record, constants) {
  return decodeStringExpression(readFieldExpression(record, 'title'), constants)
}

function directPath (record, constants) {
  const expression = readFieldExpression(record, 'path')
  if (!expression) return { expression: '', value: null, hasPath: false }
  const value = decodeStringExpression(expression, constants)
  return { expression, value: value.startsWith('/') ? value.split('?')[0] : null, hasPath: true }
}

function directPermission (record, constants) {
  return decodeStringExpression(readFieldExpression(record, 'permission'), constants)
}

function parentObjects (node, objects, lowerBound = 0, upperBound = Number.POSITIVE_INFINITY) {
  return objects
    .filter((candidate) => candidate.start >= lowerBound && candidate.end <= upperBound && candidate.start < node.start && candidate.end > node.end)
    .sort((a, b) => a.start - b.start)
}

function titlesForNode (node, parsed, lowerBound, upperBound = Number.POSITIVE_INFINITY) {
  return parentObjects(node, parsed.objects, lowerBound, upperBound)
    .map((parent) => directTitle(parent, readStringConstants()))
    .filter(Boolean)
}

function titleContextForObject (object, parsed, lowerBound, upperBound = Number.POSITIVE_INFINITY) {
  return [...titlesForNode(object, parsed, lowerBound, upperBound), directTitle(object, readStringConstants())].filter(Boolean)
}

function directChildReference (record) {
  const expression = readFieldExpression(record, 'children')
  if (!expression || expression.startsWith('[')) return null
  return expression.match(/^([A-Za-z_$][\w$]*)/)?.[1] || null
}

function nearestObject (position, parsed, lowerBound, upperBound) {
  return parsed.objects
    .filter((object) => object.start >= lowerBound && object.end <= upperBound && object.start <= position && object.end > position)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] || null
}

function spreadReferences (parsed, start, end) {
  const result = []
  const segment = parsed.masked.slice(start, end)
  for (const match of segment.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    result.push({ name: match[1], position: start + match.index })
  }
  return result
}

function resolveMenuVariable (file, name, seen = new Set()) {
  const marker = `${file}#${name}`
  if (seen.has(marker)) return null
  seen.add(marker)
  const parsed = readSourceFile(file)
  const definition = readVariableDefinition(parsed, name)
  if (definition?.arrayStart !== -1 && definition?.arrayStart !== undefined) return { file, name, definition }

  const expression = definition?.expression || ''
  const called = expression.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1]
  if (called) {
    const resolvedCall = resolveMenuVariable(file, called, seen)
    if (resolvedCall) return resolvedCall
  }
  const imported = readImports(parsed).get(name)
  if (imported) return resolveMenuVariable(imported.file, imported.name, seen)
  if (called) {
    const importedCall = readImports(parsed).get(called)
    if (importedCall) return resolveMenuVariable(importedCall.file, importedCall.name, seen)
  }
  return null
}

function sourceSystemForFile (file) {
  const rel = path.relative(PORTAL_REPO, file).split(path.sep).join('/')
  if (rel === 'app/portal/menus/index.js') return 'portal'
  if (rel === 'app/portal/menus/mall.v2.js') return 'platform'
  const match = rel.match(/^app\/portal\/menus\/([^/]+)/)
  return match?.[1]?.replace(/\.js$/, '') || 'portal'
}

function collectVariableEntries (file, name, contextTitles, state, output) {
  const resolved = resolveMenuVariable(file, name)
  if (!resolved) {
    state.errors.push(`无法解析菜单变量：${path.relative(PORTAL_REPO, file)}:${name}`)
    return
  }
  const marker = `${resolved.file}#${resolved.name}#${contextTitles.join('>')}`
  if (state.stack.has(marker)) {
    state.errors.push(`菜单变量循环引用：${marker}`)
    return
  }
  state.stack.add(marker)

  const parsed = readSourceFile(resolved.file)
  const definition = resolved.definition
  const objects = parsed.objects.filter((object) => object.start > definition.arrayStart && object.end <= definition.arrayEnd)
  for (const object of objects) {
    const pathInfo = directPath(object, state.constants)
    if (pathInfo.hasPath) {
      output.push({
        file: resolved.file,
        node: object,
        title: directTitle(object, state.constants) || '(未命名菜单)',
        menuPath: pathInfo.value,
        pathExpression: pathInfo.expression,
        permission: directPermission(object, state.constants),
        parentTitles: [...contextTitles, ...titlesForNode(object, parsed, definition.arrayStart, definition.arrayEnd)],
      })
    }

    const child = directChildReference(object)
    if (child && resolveMenuVariable(resolved.file, child)) {
      collectVariableEntries(resolved.file, child, [...contextTitles, ...titleContextForObject(object, parsed, definition.arrayStart, definition.arrayEnd)], state, output)
    }
  }

  for (const spread of spreadReferences(parsed, definition.arrayStart, definition.arrayEnd)) {
    const owner = nearestObject(spread.position, parsed, definition.arrayStart, definition.arrayEnd)
    const context = owner
      ? [...contextTitles, ...titleContextForObject(owner, parsed, definition.arrayStart, definition.arrayEnd)]
      : contextTitles
    if (resolveMenuVariable(resolved.file, spread.name)) {
      collectVariableEntries(resolved.file, spread.name, context, state, output)
    }
  }
  state.stack.delete(marker)
}

function findRootObject (file, variable, title, state) {
  const resolved = resolveMenuVariable(file, variable)
  if (!resolved) {
    state.errors.push(`无法解析范围根变量：${path.relative(PORTAL_REPO, file)}:${variable}`)
    return null
  }
  const parsed = readSourceFile(resolved.file)
  const definition = resolved.definition
  const candidates = parsed.objects.filter((object) => (
    object.start > definition.arrayStart && object.end <= definition.arrayEnd && directTitle(object, state.constants) === title
  ))
  return candidates.find((candidate) => !parentObjects(candidate, parsed.objects, definition.arrayStart, definition.arrayEnd).some((parent) => directTitle(parent, state.constants))) || candidates[0] || null
}

function collectRootEntries (file, variable, title, state, output) {
  const root = findRootObject(file, variable, title, state)
  if (!root) {
    state.errors.push(`范围根漂移：${title}（${path.relative(PORTAL_REPO, file)}:${variable}）`)
    return
  }
  const parsed = readSourceFile(root.file || file)
  const resolved = resolveMenuVariable(file, variable)
  const sourceFile = resolved?.file || file
  const sourceParsed = readSourceFile(sourceFile)
  const descendants = sourceParsed.objects.filter((object) => object.start >= root.start && object.end <= root.end)
  for (const object of descendants) {
    const pathInfo = directPath(object, state.constants)
    if (pathInfo.hasPath) {
      output.push({
        file: sourceFile,
        node: object,
        title: directTitle(object, state.constants) || '(未命名菜单)',
        menuPath: pathInfo.value,
        pathExpression: pathInfo.expression,
        permission: directPermission(object, state.constants),
        parentTitles: titlesForNode(object, sourceParsed, root.start, root.end),
      })
    }
    const child = directChildReference(object)
    if (child && resolveMenuVariable(sourceFile, child)) {
      collectVariableEntries(sourceFile, child, titleContextForObject(object, sourceParsed, root.start, root.end), state, output)
    }
  }
  for (const spread of spreadReferences(sourceParsed, root.start, root.end)) {
    const owner = nearestObject(spread.position, sourceParsed, root.start, root.end)
    const context = owner ? titleContextForObject(owner, sourceParsed, root.start, root.end) : [title]
    if (resolveMenuVariable(sourceFile, spread.name)) {
      collectVariableEntries(sourceFile, spread.name, context, state, output)
    }
  }
}

function isExternalScopeEntry (entry) {
  // 权限码带 `/dashboard/frame` 并不等于菜单页是 iframe；Portal 仍有普通 Vue
  // 页面复用这类权限码。只有路径表达式由 iframe 包装，或路径本身无法落成菜单路径，
  // 才把它标成外部页面。
  return entry.menuPath === null || /iframeLinkGenerator/.test(entry.pathExpression)
}

function scopeEvidence (entry, spec) {
  const rel = path.relative(PORTAL_REPO, entry.file).split(path.sep).join('/')
  return [`${rel}:${entry.node.lineIndex + 1}`, `selected by ${spec.selector}`]
}

function readGitValue (args) {
  try {
    return execFileSync('git', ['-C', PORTAL_REPO, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function scopeSourceContentHash () {
  const hash = crypto.createHash('sha256')
  for (const relative of SCOPE_SOURCE_RELATIVE_FILES) {
    const file = path.join(PORTAL_REPO, relative)
    if (!fs.existsSync(file)) die(`范围模型来源文件不存在：${file}`)
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function validateGeneratedScope (model) {
  const errors = []
  const expectedRoots = new Map(SCOPE_ROOT_SPECS.map((root) => [root.rootId, root.title]))
  const roots = new Set()
  const keys = new Set()
  const menuPaths = new Set()
  const permissions = new Set()
  for (const root of model.roots) {
    if (roots.has(root.rootId)) errors.push(`根重复：${root.rootId}`)
    roots.add(root.rootId)
    if (expectedRoots.get(root.rootId) !== root.title) errors.push(`根漂移：${root.rootId} -> ${root.title}`)
  }
  for (const root of SCOPE_ROOT_SPECS) if (!roots.has(root.rootId)) errors.push(`根缺失：${root.rootId}`)
  for (const item of model.items) {
    const expectedKey = item.menuPath || item.permission
    if (!expectedKey || item.key !== expectedKey) errors.push(`主键不是菜单/权限路径：${item.key}`)
    if (keys.has(item.key)) errors.push(`重复菜单/权限路径：${item.key}`)
    keys.add(item.key)
    if (item.menuPath !== null) {
      if (menuPaths.has(item.menuPath)) errors.push(`重复菜单路径：${item.menuPath}`)
      menuPaths.add(item.menuPath)
    }
    if (item.permission) {
      if (permissions.has(item.permission)) errors.push(`重复权限路径：${item.permission}`)
      permissions.add(item.permission)
    }
    if (!roots.has(item.rootId)) errors.push(`无归属项：${item.key} -> ${item.rootId}`)
    if (item.kind === 'iframe' && item.callable) errors.push(`iframe 不可调用约束失败：${item.key}`)
    if (item.menuPath === null && !item.permission) errors.push(`无路径 iframe 缺少 permission：${item.title}`)
  }
  return [...new Set(errors)]
}

function validateScopeAgainstPageCatalog (items, catalog) {
  const errors = []
  for (const item of items) {
    const match = catalog.find((candidate) => candidate.menuPath === item.menuPath && candidate.permission === item.permission)
    if (!match) errors.push(`page-catalog 不一致：${item.key}（${item.menuSource}）`)
    else {
      if (match.menuSource !== item.menuSource) errors.push(`page-catalog 来源不一致：${item.key}（${item.menuSource} != ${match.menuSource}）`)
      const catalogIframe = match.kind === 'iframe 嵌入外部系统'
      if (catalogIframe !== (item.kind === 'iframe')) errors.push(`page-catalog 页面形态不一致：${item.key}`)
    }
  }
  return errors
}

export function buildPortalScope (catalog) {
  scopeSourceCache.clear()
  const state = { constants: readStringConstants(), errors: [], stack: new Set() }
  const roots = []
  const rawEntries = []

  for (const spec of SCOPE_ROOT_SPECS) {
    const file = path.join(PORTAL_REPO, spec.file)
    roots.push({
      rootId: spec.rootId,
      title: spec.title,
      sourceSystem: spec.sourceSystem,
      menuSource: spec.file,
      selector: spec.selector,
      included: true,
      evidence: [spec.selector],
    })
    if (spec.rootId === 'hr/人力') {
      collectVariableEntries(file, spec.variable, [], state, rawEntries)
    } else {
      collectRootEntries(file, spec.variable, spec.title, state, rawEntries)
    }
  }

  const items = rawEntries.map((entry, index) => {
    const external = isExternalScopeEntry(entry)
    const menuPath = entry.menuPath
    const key = menuPath || entry.permission
    const sourceSystem = sourceSystemForFile(entry.file)
    const root = SCOPE_ROOT_SPECS.find((spec) => {
      if (sourceSystem === 'hr' && spec.rootId === 'hr/人力') return true
      if (sourceSystem === 'platform' && spec.rootId.startsWith('platform/')) return entry.parentTitles.includes(spec.title)
      if (spec.rootId === 'portal/系统设置') return entry.parentTitles.includes('系统设置')
      return spec.sourceSystem === 'portal' && entry.title === spec.title
    })
    if (!root) state.errors.push(`菜单项无范围根：${key || `(index ${index})`}`)
    return {
      key,
      title: entry.title,
      menuPath,
      permission: entry.permission,
      parentTitles: entry.parentTitles,
      menuSource: path.relative(PORTAL_REPO, entry.file).split(path.sep).join('/'),
      sourceSystem,
      rootId: root?.rootId || '',
      included: true,
      status: external ? 'external' : 'included',
      callable: !external,
      reason: external ? '范围内菜单节点，但路径由 Portal iframe 包装或权限指向 frame；SDK 不把外部页面当作可调用能力。' : `由固定范围根「${root?.title || '未知'}」直接或递归收录。`,
      evidence: scopeEvidence(entry, root || SCOPE_ROOT_SPECS[0]),
      kind: external ? 'iframe' : 'page',
    }
  })

  const sourceRevision = readGitValue(['rev-parse', 'HEAD']) || scopeSourceContentHash()
  const sourceContentHash = scopeSourceContentHash()
  const model = {
    schema: 'portal-menu-scope/v1',
    sourceRevision,
    sourceContentHash,
    source: {
      repo: PORTAL_REPO,
      branch: readGitValue(['branch', '--show-current']) || 'unknown',
      files: SCOPE_SOURCE_RELATIVE_FILES,
    },
    roots,
    items,
    summary: {
      itemCount: items.length,
      callableCount: items.filter((item) => item.callable).length,
      externalCount: items.filter((item) => item.status === 'external').length,
      byRoot: Object.fromEntries(SCOPE_ROOT_SPECS.map((root) => [root.rootId, items.filter((item) => item.rootId === root.rootId).length])),
    },
    validation: { ok: false, errors: [] },
  }
  model.validation.errors = [
    ...state.errors,
    ...validateGeneratedScope(model),
    ...validateScopeAgainstPageCatalog(items, catalog),
  ]
  model.validation.ok = model.validation.errors.length === 0
  if (!model.validation.ok) die(`范围模型校验失败：\n${model.validation.errors.map((error) => `- ${error}`).join('\n')}`)
  return model
}

function markdownCell (value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderPortalScopeMarkdown (scope) {
  const lines = [
    '# Portal 保留菜单范围与覆盖基线',
    '',
    '> 本文件由 `tools/generate/generate.mjs` 生成；菜单范围以 Portal 源码递归解析结果为准。',
    '',
    `- 来源分支：\`${scope.source.branch}\``,
    `- 来源提交：\`${scope.sourceRevision}\``,
    `- 来源内容哈希：\`${scope.sourceContentHash}\``,
    `- 菜单节点：${scope.summary.itemCount}（可调用 ${scope.summary.callableCount}，外部 iframe ${scope.summary.externalCount}）`,
    '- 当前表格是菜单入口基线；页面动作、capability、支撑接口和真实证据由页面审计矩阵继续补齐。',
    '',
    '## 根节点',
    '',
    '| 根 | 来源系统 | 节点数 |',
    '| --- | --- | ---: |',
    ...scope.roots.map((root) => `| ${markdownCell(root.title)} | ${markdownCell(root.sourceSystem)} | ${scope.summary.byRoot[root.rootId] ?? 0} |`),
    '',
    '## 菜单节点',
    '',
    '| 根 | 菜单标题 | 菜单路径 | 权限 | 父级路径 | 来源文件 | 状态 | 可调用 | 依据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...scope.items.map((item) => [
      item.rootId,
      item.title,
      item.menuPath ?? '（iframe 无菜单路径）',
      item.permission || '（无）',
      item.parentTitles.join(' / ') || '（根）',
      item.menuSource,
      item.status,
      item.callable ? '是' : '否',
      item.evidence.join('；'),
    ].map(markdownCell).join(' | ')).map((line) => `| ${line} |`),
    '',
    '## 审计边界',
    '',
    '- 注释掉的菜单不进入模型。',
    '- “科技/财务/资产/生产/采购/销售”仅作为来源系统分类；门户“系统设置”、平台“平台设置”和人力保留树中的节点仍按菜单归属保留。',
    '- iframe 节点属于保留菜单树，但 SDK 不把外部页面误包装成可调用 capability。',
  ]
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// 7. 输出
// ---------------------------------------------------------------------------
function main () {
  if (!fs.existsSync(MENUS_INDEX)) {
    die(`找不到 Portal 菜单源码：${MENUS_INDEX}\n请传入正确的仓库路径，或设置 PORTAL_REPO。`)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const rules = extractModuleTypeRules()
  const ruleTable = {
    generatedAt: new Date().toISOString(),
    source: 'CodeReview_Projects_Js@test/portal/main@app/portal/menus/index.js (all_menus_type_match) + app/portal/utils/define.js',
    portalRepo: PORTAL_REPO,
    rules,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'module-type-rules.json'), JSON.stringify(ruleTable, null, 2))

  const catalog = buildPageCatalog(rules)
  fs.writeFileSync(path.join(OUT_DIR, 'page-catalog.json'), JSON.stringify({
    generatedAt: ruleTable.generatedAt,
    portalRepo: PORTAL_REPO,
    total: catalog.length,
    items: catalog,
  }, null, 2))

  const scope = buildPortalScope(catalog)
  fs.writeFileSync(path.join(OUT_DIR, 'portal-scope.json'), JSON.stringify(scope, null, 2))
  fs.writeFileSync(SCOPE_DOC_OUT, renderPortalScopeMarkdown(scope))

  const withType = catalog.filter((i) => i.moduleType !== null).length
  const resolved = catalog.filter((i) => i.kind !== '(未解析)').length
  process.stdout.write(
    `[generate] Portal 仓库：${PORTAL_REPO}\n` +
    `[generate] module-type 规则：${rules.length} 条 ` +
    `(prefix ${rules.filter((r) => r.kind === 'prefix').length} / paths ${rules.filter((r) => r.kind === 'paths').length})\n` +
    `[generate] 页面清单：${catalog.length} 行，其中能解析路由文件 ${resolved} 行，能推出 module-type ${withType} 行\n` +
    `[generate] 范围模型：${scope.items.length} 项（可调用 ${scope.summary.callableCount} / 外部 ${scope.summary.externalCount}）\n` +
    `[generate] 已写入 ${path.relative(PKG_ROOT, path.join(OUT_DIR, 'module-type-rules.json'))}、${path.relative(PKG_ROOT, path.join(OUT_DIR, 'page-catalog.json'))}、${path.relative(PKG_ROOT, path.join(OUT_DIR, 'portal-scope.json'))} 与 ${path.relative(PKG_ROOT, SCOPE_DOC_OUT)}\n`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
