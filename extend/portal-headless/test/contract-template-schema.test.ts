import { expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
function schema() {
  const result = catalog.describeSchema('contract-template-content')
  if (!result.ok) throw new Error(result.reason)
  return result.schema
}

it('SDK 下钻给出可新建组件并排除禁用旧组件', () => {
  const content = schema()
  expect(content.blocks.map(b => b.name).sort()).toEqual([
    'Common/EmptyLine', 'Common/Heading', 'Common/Paragraph', 'Common/PrintPageBreak', 'Common/RichText', 'Common/Table', 'Common/Title',
    'Contract/AutoDirectory', 'Contract/Cover', 'Contract/SignatoryName', 'Contract/SignatoryStamp', 'Contract/SigningInfo', 'Supply/MaterialList',
  ])
  expect(content.historicalBlocks[0]?.name).toBe('Supply/Table')
  expect(catalog.describeSchema('not-a-schema')).toEqual({ ok: false, id: 'not-a-schema', reason: '不存在此结构说明' })
  for (const id of ['contract-template-create', 'contract-template-update']) {
    const d = catalog.describe(id)
    if (!d.ok) throw new Error('能力未注册')
    expect(d.params.find(p => p.name === 'content')?.contract?.source).toContain("catalog.describeSchema('contract-template-content')")
  }
})

it('结构化合同约束针对实际业务分支，封面和目录有单例顺序', () => {
  const content = schema()
  const cover = content.blocks.find(b => b.name === 'Contract/Cover')!
  expect(cover.dataFields.find(f => f.path === 'layout')?.values).toEqual({ minimal: '极简型，fields 0 项', parties: '双方信息型，fields 最多 5 项', engineering: '工程信息型，fields 最多 8 项' })
  expect(content.constraints.join(' ')).toContain('无封面时目录位于 blocks[0]')
  expect(cover.dataFields.find(f => f.path === 'title')?.constraints?.join(' ')).toContain('最多 60 字')
  expect(cover.dataFields.find(f => f.path === 'code.content')?.constraints?.join(' ')).toContain('最多 100 字')
  const signing = content.blocks.find(b => b.name === 'Contract/SigningInfo')!
  expect(signing.dataFields.find(f => f.path === 'parties')?.constraints).toEqual(['恰好两方'])
  expect(signing.dataFields.find(f => f.path === 'parties[].fields')?.constraints?.join(' ')).toContain('最多 12 项')
  expect(signing.dataFields.find(f => f.path === 'parties[].subjectContent')?.constraints?.join(' ')).toContain('Java 未校验')
  expect(content.blocks.find(b => b.name === 'Common/Paragraph')?.dataFields.find(f => f.path === 'content')?.meaning).toContain('支持换行')
})

it('变量标识、物料字段和表格坐标不能混用，模板内容以字符串提交', () => {
  const content = schema()
  expect(content.variables.find(v => v.label === '甲方名称')?.contractKey).toBe('commonPartyNameA')
  expect(content.variables.find(v => v.label === '供:采购商品列表')?.valueType).toBe('JSON 数组字符串')
  expect(content.materialListFields.find(f => f.path === 'price')?.meaning).toContain('元')
  expect(content.materialListFields.find(f => f.path === 'amount')?.meaning).toContain('不自动重算')
  expect(content.tableSchema.fields.find(f => f.path === 'cells[].x')?.meaning).toContain('列索引，0 起')
  expect(content.tableSchema.fields.find(f => f.path === 'cells[].y')?.meaning).toContain('行索引，0 起')
  expect(content.constraints.join(' ')).toContain('JSON.stringify')
  expect(content.variableSyntax.constraints.join(' ')).toContain('缺失变量为空串')
  const json = JSON.stringify({ version: '1.1.0', blocks: [{ id: 'heading-1', name: 'Common/Heading', data: { level: 1, content: '<%= 甲方名称 %>' } }] })
  expect(JSON.parse(json).blocks[0].data.content).toBe(content.variableSyntax.raw)
})
