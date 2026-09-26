import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildCoverage, coverageCheckPassed, evaluatePortalMenus, type MenuAudit } from '../tools/generate/pc-coverage.mjs'

const roots: string[] = []
const tool = fileURLToPath(new URL('../tools/generate/pc-coverage.mjs', import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'portal-pc-coverage-'))
  roots.push(root)
  const write = (file: string, text: string) => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text) }
  write('build/env/.env.build.test', 'VITE_CRM_URL=https://crm.invalid\nVITE_PRODUCT_URL=https://product.invalid/\nVITE_FLOW_ENGINE_URL=https://flow.invalid\n')
  write('app/portal/components/portal/layout/index.vue', `if (active === SYSTEM_COMMON_VALUE) result = menus.value.filter(menu => !menu.system); else result = menus.value.filter(menu => menu.system === active)`)
  write('common/utils/system-color-palette.js', `import { generate } from '@ant-design/colors';
    export const systemColorPalette = { green: '#52C41A' };
    export const auxiliaryColorPalette = { orange: '#FA8B02' };
    export const auxiliaryColorLadders = { purple: generate('#6547DD') };
  `)
  write('app/portal/utils/define.js', `import { auxiliaryColorLadders, auxiliaryColorPalette, systemColorPalette } from '../../../common/utils/system-color-palette.js';
    export const SYSTEM_HR_VALUE=1; export const SYSTEM_PLATFORM_VALUE=10; export const SYSTEM_COMMON_VALUE=0;
    export const COLORS = [systemColorPalette.green, auxiliaryColorPalette.orange, auxiliaryColorLadders.purple[4]];
  `)
  write('common/components/common/layout/dashboard/sidebar/define.js', `export function menusAddID(rows,system) { const copy=JSON.parse(JSON.stringify(rows)); const visit=nodes=>nodes.forEach(n=>{if(system)n.system=system;if(n.children)visit(n.children)});visit(copy);return copy }`)
  write('app/portal/menus/hr.js', `
    import {menusAddID} from 'common/components/common/layout/dashboard/sidebar/define.js';
    import {SYSTEM_HR_VALUE} from 'app/portal/utils/define.js';
    export const PATH_TASK_MY='/dashboard/flow/task/my/list';
    export const all_menus=menusAddID([{title:'人力',children:[
      {title:'我的流程',path:PATH_TASK_MY},
      // {title:'已撤下页',path:'/dashboard/disabled/list'},
      {title:'审批 iframe',path:'/dashboard/frame?flow=fixture',permission:'/dashboard/frame/bpm/form'}
    ]}],SYSTEM_HR_VALUE);
    export const setting_menus=[{title:'系统核算参数',path:'/dashboard/setting/system-accounting-parameters/list'}];
  `)
  write('app/portal/menus/mall.v2.js', `import {SYSTEM_PLATFORM_VALUE} from 'app/portal/utils/define.js';export const all_menus=[{title:'平台',system:SYSTEM_PLATFORM_VALUE,children:[{title:'实际平台页',path:'/dashboard/platform/live/list'}]}]`)
  write('app/portal/menus/mall.js', `export const all_menus=[{title:'旧平台',system:10,path:'/dashboard/platform/stale/list'}]`)
  write('app/portal/menus/index.js', `
    import {all_menus as hr,setting_menus} from './hr.js';
    import {all_menus as platform} from './mall.v2.js';
    const isDev=import.meta.env.VITE_API_ENV_NAME==='dev';
    export const all_menus=[...hr,...platform,
      ...(isDev||import.meta.env.DEV?[{title:'DEV工具',path:'/dashboard/dev'}]:[]),
      {title:'系统设置',children:setting_menus},
      {title:'首页',path:'/dashboard/home'}
    ];
  `)
  write('package.json', '{"type":"module"}')
  write('dist/index.js', `export function createPortalHeadless(){return {capabilities:[],catalog:{describe(){throw new Error('no definitions')}}}}`)
  return { root, write }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('三系统 PC 页面挂载审计', () => {
  it('按真实 index ESM 导入图求值，保留常量、排除注释/DEV/未导入旧菜单', async () => {
    const { root } = fixture()
    const report = await evaluatePortalMenus(root)
    expect(report.systems.map(system => [system.key, system.leaves.length])).toEqual([['hr', 2], ['platform', 1], ['portal', 2]])
    expect(report.systems[0]?.leaves.map(leaf => leaf.capabilityPath)).toEqual(['/dashboard/flow/task/my/list', '/dashboard/frame/bpm/form'])
    expect(report.systems[1]?.leaves.map(leaf => leaf.path)).toEqual(['/dashboard/platform/live/list'])
    expect(report.systems[2]?.leaves.map(leaf => leaf.path)).toEqual(['/dashboard/setting/system-accounting-parameters/list', '/dashboard/home'])
    expect(JSON.stringify(report)).not.toContain('/dashboard/dev"')
    expect(JSON.stringify(report)).not.toContain('/dashboard/disabled/list')
    expect(Object.keys(report.sourceHashes)).toContain('app/portal/menus/mall.v2.js')
    expect(Object.keys(report.sourceHashes)).toContain('common/utils/system-color-palette.js')
    expect(Object.keys(report.sourceHashes)).not.toContain('app/portal/menus/mall.js')
  })
  it('palette 源码属于菜单求值依赖，内容变化必须改变 source hash', async () => {
    const { root, write } = fixture()
    const first = await evaluatePortalMenus(root)
    const firstHash = first.sourceHashes['common/utils/system-color-palette.js']
    expect(firstHash).toBeDefined()

    write('common/utils/system-color-palette.js', `import { generate } from '@ant-design/colors';
      export const systemColorPalette = { green: '#52C41A' };
      export const auxiliaryColorPalette = { orange: '#FA8B02' };
      export const auxiliaryColorLadders = { purple: generate('#6547DE') };
    `)
    const second = await evaluatePortalMenus(root)
    expect(second.sourceHashes['common/utils/system-color-palette.js']).not.toBe(firstHash)
  })
  it('不能可靠求值的未知 import、env、浏览器调用、路径立即报错', async () => {
    for (const source of [
      `import {x} from 'unknown-package'; export const all_menus=x`,
      `export const all_menus=import.meta.env.VITE_UNKNOWN`,
      `import {cookie} from 'app/portal/utils/storage.js';export const all_menus=cookie.get('menu')`,
      `import './hr.js'; export const all_menus=[{title:'人力',system:1,path:null}]`,
    ]) {
      const { root, write } = fixture()
      write('app/portal/menus/index.js', source)
      await expect(evaluatePortalMenus(root)).rejects.toThrow()
    }
  })
  it('系统选择器改变时停止，不能沿旧分组静默计算', async () => {
    const { root, write } = fixture()
    write('app/portal/components/portal/layout/index.vue', 'result=menus.value.filter(menu => menu.newSystem === active)')
    await expect(evaluatePortalMenus(root)).rejects.toThrow('选择器源码规则已变化')
  })
  it('完全没有系统叶子时不发布零分母', async () => {
    const { root, write } = fixture()
    write('app/portal/menus/mall.v2.js', 'export const all_menus=[]')
    await expect(evaluatePortalMenus(root)).rejects.toThrow('没有活跃叶子')
  })
  it('只统计真实注册挂载，说明缺失与明确 gaps 分开，iframe按权限路径连接', async () => {
    const { root } = fixture()
    const menus = await evaluatePortalMenus(root)
    const caps = [
      { id: 'mine', title: '我的流程', pagePath: '/dashboard/flow/task/my/list', write: false },
      { id: 'iframe', title: '表单', pagePath: '/dashboard/frame/bpm/form', write: false },
      { id: 'outside', title: '非菜单能力', pagePath: '/base-data/device', write: false },
    ]
    const report = buildCoverage(menus, caps, id => id === 'mine' ? { ok: true, ai: { gaps: ['实际状态未验证'] } } : { ok: true })
    const hr = report.systems[0]!
    expect(report.title).toBe('人力 / 平台 / 门户 PC 页面挂载率')
    expect(hr).toMatchObject({ activeLeaves: 2, attachedLeaves: 2, registeredCapabilityCount: 2, pageAttachmentRate: 1 })
    expect(hr.explicitAiGaps).toEqual([{ capabilityId: 'mine', path: '/dashboard/flow/task/my/list', gaps: ['实际状态未验证'] }])
    expect(hr.missingAiDescriptions).toEqual(['iframe'])
    expect(report.systems[2]?.zeroCapabilityLeaves).toHaveLength(2)
    expect(report.totalRegisteredCapabilities).toBe(3)
    expect(report.functionalCoverage).toBe('unknown')
    expect(report.actionInventory).toBe('unknown')
    expect(report.browserVerification).toBe('unknown')
    expect(coverageCheckPassed(report)).toBe(false)
  })
  it('每一页均有无 gaps 能力仍不能令功能验收变绿', async () => {
    const menus = await evaluatePortalMenus(fixture().root)
    const caps = menus.systems.flatMap(system => system.leaves.map((leaf, i) => ({ id: `${system.key}-${i}`, title: leaf.title, pagePath: leaf.capabilityPath, write: false })))
    const report = buildCoverage(menus, caps, () => ({ ok: true, ai: { gaps: [] } }))
    expect(report.systems.every(system => system.pageAttachmentRate === 1)).toBe(true)
    expect(coverageCheckPassed(report)).toBe(false)
  })
  it('重复能力和登记但describe失败不能被算成覆盖', () => {
    const menus: MenuAudit = { portalRepo: 'fixture', revision: null, environment: 'test', sourceHashes: {}, adapters: [], systems: [{ key: 'hr', title: '人力', leaves: [{ path: '/a', capabilityPath: '/a', title: 'A', permission: null, iframe: false, breadcrumbs: [] }] }] }
    const cap = { id: 'a', pagePath: '/a', title: 'A', write: false }
    expect(() => buildCoverage(menus, [cap, cap], () => ({ ok: true }))).toThrow('重复能力')
    expect(() => buildCoverage(menus, [cap], () => ({ ok: false }))).toThrow('无法 describe')
  })
  it('CLI --json可解析，--check缺口退出1，求值错误退出2', () => {
    const { root } = fixture()
    const args = [tool, '--portal-repo', root, '--sdk-root', root, '--json']
    const preview = spawnSync(process.execPath, args, { encoding: 'utf8' })
    expect(preview.status).toBe(0)
    expect(JSON.parse(preview.stdout).metric).toBe('page-attachment-rate')
    const checked = spawnSync(process.execPath, [...args, '--check'], { encoding: 'utf8' })
    expect(checked.status).toBe(1)
    expect(JSON.parse(checked.stdout).actionInventory).toBe('unknown')
    const invalid = spawnSync(process.execPath, [tool, '--unknown'], { encoding: 'utf8' })
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr).toContain('未知参数')
  })
})
