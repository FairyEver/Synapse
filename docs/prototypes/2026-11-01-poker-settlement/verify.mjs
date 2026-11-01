import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../../..')
const dashboard = path.join(repository, 'dashboard')
const requireDashboard = createRequire(path.join(dashboard, 'package.json'))
const ts = requireDashboard('typescript')
const dataModule = async code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { scenarios, delta, format, signed } = await dataModule(transpile(await readFile(path.join(directory, 'model.ts'), 'utf8')))
const deck = await readFile(path.join(repository, 'server/src/game/poker/engine/deck.ts'), 'utf8')
const hand = await readFile(path.join(repository, 'server/src/game/poker/engine/hand.ts'), 'utf8')
const { evaluate, compareHands, handRankName } = await dataModule(transpile(`${deck}\n${hand.replace(/^import .*orderedDeck.*\n/m, '')}`))

// 用项目现有的真实判牌器独立核对示例，而不是另写一套牌型规则。
for (const s of scenarios) {
  assert.equal(s.players.filter(p => p.me).length, 1, `${s.id}: 本人唯一`)
  assert.equal(s.players.reduce((sum, p) => sum + delta(p), 0), 0, `${s.id}: 净变化守恒`)
  const dealt = [...s.board, ...s.players.flatMap(p => p.hole ?? [])]
  assert.equal(new Set(dealt).size, dealt.length, `${s.id}: 无重复牌`)
  assert.equal(s.players.reduce((sum, p) => sum + p.invested, 0), s.pots.reduce((sum, p) => sum + p.amount, 0), `${s.id}: 投入与底池守恒`)
  for (const [i, p] of s.players.entries()) {
    assert.equal(p.payout, s.pots.reduce((sum, pot) => sum + (pot.shares[i] ?? 0), 0), `${s.id}: 个人分配准确`)
    if (p.folded) assert.equal(p.hole, undefined, `${s.id}: 隐藏暗牌`)
    if (p.best) {
      assert.ok(p.best.every(card => [...s.board, ...p.hole].includes(card)), `${s.id}: 最佳五张来源合法`)
      assert.deepEqual(evaluate(p.best, s.variant), evaluate([...s.board, ...p.hole], s.variant), `${s.id}: 确为最佳五张`)
      assert.equal(handRankName(p.best, s.variant), p.rank, `${s.id}: 牌型名称准确`)
    }
  }
  for (const pot of s.pots) {
    assert.equal(Object.values(pot.shares).reduce((a, b) => a + b, 0), pot.amount, `${s.id}: 分池守恒`)
    if (pot.refund || pot.eligible.length < 2) continue
    for (const winner of Object.keys(pot.shares).map(Number)) {
      assert.ok(pot.eligible.includes(winner), `${s.id}: 赢家有资格参与底池`)
      for (const opponent of pot.eligible) {
        assert.ok(compareHands([...s.board, ...s.players[winner].hole], [...s.board, ...s.players[opponent].hole], s.variant) >= 0, `${s.id}: 真实判牌器确认赢家`)
      }
    }
  }
}

const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, skipLibCheck: true, noUnusedLocals: true, noUnusedParameters: true,
  types: [], paths: {
    'react': [path.join(dashboard, 'node_modules/@types/react/index.d.ts')],
    'react/*': [path.join(dashboard, 'node_modules/@types/react/*')],
    'react-dom/*': [path.join(dashboard, 'node_modules/@types/react-dom/*')],
    '@heroui/react': [path.join(path.dirname(requireDashboard.resolve('@heroui/react/package.json')), 'dist/index.d.ts')],
    'lucide-react': [path.join(path.dirname(requireDashboard.resolve('lucide-react/package.json')), 'dist/lucide-react.d.ts')],
  },
}
const program = ts.createProgram([path.join(directory, 'preview.tsx'), path.join(directory, 'model.ts'), path.join(path.dirname(requireDashboard.resolve('vite/package.json')), 'client.d.ts')], options)
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: file => file, getCurrentDirectory: () => repository, getNewLine: () => '\n',
}))

// 离线 DOM 冒烟验证，不启动浏览器、开发服务器或真实应用。
const { JSDOM, VirtualConsole } = requireDashboard('jsdom')
const errors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => { if (error.type !== 'css-parsing' && error.type !== 'not-implemented') errors.push(error.message) })
virtualConsole.on('error', error => errors.push(String(error)))
const dom = new JSDOM(await readFile(path.join(directory, 'index.html'), 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  beforeParse(window) {
    window.matchMedia = query => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    window.HTMLElement.prototype.scrollIntoView = function () {}
    window.Element.prototype.getAnimations = () => []
    window.CSS = { supports: () => false, escape: value => value }
  },
})
const document = dom.window.document
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error(`${label}: ${errors.join('; ')}`)
}
try {
  for (const [i, s] of scenarios.entries()) {
    if (i) document.querySelectorAll('.scenario-button')[i].click()
    await until(() => document.querySelector('[role="dialog"]')?.textContent.includes(`第 ${s.hand} 手`), `打开场景 ${s.id}`)
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog.textContent.includes(s.title))
    const mine = s.players.find(p => p.me)
    assert.ok(dialog.querySelector('.personal-result').textContent.includes(signed(delta(mine))))
    const rows = dialog.querySelectorAll('tbody tr')
    assert.equal(rows.length, s.players.length)
    s.players.forEach((p, index) => {
      const row = rows[index]
      assert.ok(row.textContent.includes(format(p.payout)))
      assert.equal(row.querySelectorAll('.hole-cards img').length, p.hole?.length ?? 0)
    })
    const compare = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith(`查看${s.players[1].name}`))
    if (s.players[1].best) {
      compare.click()
      await until(() => document.querySelector('.best-section')?.getAttribute('aria-label') === `${s.players[1].name}的最佳五张牌`, '切换比牌')
    }
    const pots = [...dialog.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.includes('底池分配'))
    pots.click()
    await until(() => dialog.querySelector('.pot-row'), '展开底池')
    assert.equal(dialog.querySelectorAll('.pot-row').length, s.pots.length)
    const rankToggle = [...dialog.querySelectorAll('button')].find(b => b.textContent.includes('牌型顺序'))
    rankToggle.click()
    await until(() => dialog.querySelector('.rules-section'), '展开牌型顺序')
    const back = [...dialog.querySelectorAll('button')].find(b => b.textContent.includes('返回牌桌'))
    back.click()
    await until(() => !document.querySelector('[role="dialog"]'), '关闭结算')
  }
  assert.deepEqual(errors, [], '无脚本运行错误')
  process.stdout.write('通过：7 组真实判牌器 / 筹码守恒、TypeScript、离线 DOM 打开/比牌/分池/规则/关闭。\n未运行浏览器视觉、真实倒计时或线上验收。\n')
} finally { dom.window.close() }
