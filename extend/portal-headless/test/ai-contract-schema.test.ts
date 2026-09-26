import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiContract } from '../src/catalog/ai-contract.js'
import type { CapabilityDefinition } from '../src/capabilities/types.js'

type Issue = { capabilityId: string; path: string; code: string; message: string }
type Options = {
  profile?: 'structural' | 'complete'
  definitions?: CapabilityDefinition[] | Map<string, CapabilityDefinition>
  contracts?: Record<string, AiContract> | Map<string, AiContract>
  bindings?: Record<string, string> | Map<string, string>
  sdkPaths?: string[]
}
// Runtime import follows other zero-dependency generator tests; no generated .d.ts.
const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
const { validateAiContract, validateAiContracts, normalizeAiPath } = await import(validatorUrl) as {
  validateAiContract: (id: string, contract: unknown, options?: Options) => Issue[]
  validateAiContracts: (contracts: Record<string, AiContract> | Map<string, AiContract>, options?: Options) => Issue[]
  normalizeAiPath: (path: unknown) => string | null
}

// Independent fixture: no production contract/formatter is used to manufacture expectations.
function fixture(): AiContract {
  return {
    purpose: '按名称寻找会议室候选，取得预定所需会议室标识。',
    whenToUse: '用户知道会议室名称，但还没有会议室 ID 时。',
    boundaries: ['候选存在不代表目标时间段空闲。'],
    effect: 'read',
    prerequisites: ['使用绑定当前用户与租户的 SDK。'],
    inputs: {
      keyword: { meaning: '会议室名称片段', source: '用户提供的会议室名称', type: 'string', required: true, format: '非空字符串', constraints: ['不得使用全空格关键字'] },
    },
    output: {
      shape: '{ list: { id: number, name: string }[], total: number }',
      fields: [
        { path: 'list[].id', type: 'number', meaning: '会议室主键，传给预定的 roomId' },
        { path: 'list[].name', type: 'string', meaning: '供用户区分候选的显示名称' },
        { path: 'total', type: 'number', meaning: '当前关键字命中的记录总数' },
      ],
      empty: 'list=[] 表示当前关键字无匹配；请求失败不能解释为空列表。',
    },
    consume: ['展示 name 让用户选择，保留对应 id；不得以名称替换 ID。'],
    steps: [],
    completion: '已交付匹配会议室或明确说明无匹配。',
    failures: ['鉴权失败时恢复原用户会话后重查，不能当作无会议室。'],
    idempotency: null,
    evidence: [{ source: 'test/fixtures/room-list.json', kind: 'test', note: '独立测试夹具，非线上验证记录。' }],
  }
}

const definition = (id: string, write = false, names = ['keyword']): CapabilityDefinition => ({ id, title: '测试能力', pagePath: '/fixture', write, params: names.map(name => ({ name, kind: 'text', required: true })) })
const codes = (issues: Issue[]) => issues.map(issue => issue.code)

describe('AI 契约结构与完成度检查', () => {
  it('独立完整夹具通过两个 profile，允许没有每能力 examples', () => {
    for (const profile of ['structural', 'complete'] as const) {
      expect(validateAiContract('rooms', fixture(), { profile, definitions: [definition('rooms')] })).toEqual([])
    }
  })

  it('缺少必填字段、错误类型、枚举和拼写不能静默通过', () => {
    const broken = { ...fixture(), effect: 'query', consume: '展示候选', completion: undefined, purpos: '拼写错误' }
    delete (broken as Partial<typeof broken>).purpose
    const issues = validateAiContract('rooms', broken)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.purpose', code: 'missing-property' }),
      expect.objectContaining({ path: '$.effect', code: 'invalid-enum' }),
      expect.objectContaining({ path: '$.consume', code: 'invalid-type' }),
      expect.objectContaining({ path: '$.completion', code: 'not-json' }),
      expect.objectContaining({ path: '$.purpos', code: 'unknown-property' }),
    ]))
    expect(issues.every(issue => issue.capabilityId === 'rooms')).toBe(true)
  })

  it.each([' ', 'TODO', '未登记', '待补充'])('不接受空白或占位说明 %s', purpose => {
    expect(validateAiContract('rooms', { ...fixture(), purpose })).toEqual(expect.arrayContaining([expect.objectContaining({ path: '$.purpose' })]))
  })

  it('兼容已约定的可选字段，并验证字段类型', () => {
    const contract = fixture()
    contract.inputs.keyword = { ...contract.inputs.keyword!, nullable: true, omitted: '省略时搜索默认范围', unit: '字符', nullMeaning: 'null 表示不筛选', requiredWhen: '按名称搜索时', default: '全部' }
    contract.output.fields[0] = { ...contract.output.fields[0]!, optional: true, nullable: true, values: { '1': '示例 ID' }, unit: '标识', format: '整数', source: '已归一 SDK 结果', nullMeaning: '历史记录未关联会议室', constraints: ['正整数'] }
    expect(validateAiContract('rooms', contract)).toEqual([])
    expect(codes(validateAiContract('rooms', { ...contract, inputs: { keyword: { ...contract.inputs.keyword, required: 'yes' } } }))).toContain('invalid-type')
  })

  it('将输出数组路径和根前缀归一化，拒绝重复和非法路径', () => {
    expect(['$.list[].id', 'list[*].id', 'list[].id'].map(normalizeAiPath)).toEqual(['list[].id', 'list[].id', 'list[].id'])
    expect(normalizeAiPath('$')).toBe('$')
    expect(normalizeAiPath('$value')).toBe('$value')
    expect(normalizeAiPath('$schema')).toBe('$schema')
    expect(normalizeAiPath('$.$schema')).toBe('$schema')
    expect(normalizeAiPath('$[].id')).toBe('[].id')
    expect(normalizeAiPath('variables.费用申请类型')).toBe('variables.费用申请类型')
    expect(normalizeAiPath('审批人.*[].用户编号')).toBe('审批人.*[].用户编号')
    expect(normalizeAiPath('result.*.id')).toBe('result.*.id')
    const contract = fixture()
    contract.output.fields.push({ path: '$.list[].id', type: 'number', meaning: '重复主键' }, { path: 'ID（转字符串）', type: 'string', meaning: '错误路径表达' })
    expect(codes(validateAiContract('rooms', contract))).toEqual(expect.arrayContaining(['duplicate-field', 'invalid-path']))
  })

  it('参数枚举保留真实类型、零值和空字符串，不受旧枚举值覆盖', () => {
    const contract = fixture()
    contract.inputs.keyword!.type = 'string | integer'
    contract.inputs.keyword!.options = [
      { value: 0, label: '待审批' }, { value: 3, label: '通过' }, { value: 4, label: '拒绝' },
      { value: '3', label: '字符串编码' }, { value: '', label: '全部' }, { value: 'todo', label: 'todo' },
    ]
    const old = definition('rooms')
    old.params[0]!.options = [{ value: 1, label: '旧通过' }, { value: 2, label: '旧拒绝' }]
    for (const profile of ['structural', 'complete'] as const) {
      expect(validateAiContract('rooms', contract, { profile, definitions: [old] })).toEqual([])
    }
  })

  it('拒绝错误枚举容器、缺字段、空标签和额外属性', () => {
    const base = fixture()
    const withOptions = (options: unknown) => ({ ...base, inputs: { keyword: { ...base.inputs.keyword, options } } })
    expect(codes(validateAiContract('rooms', withOptions({ value: 1, label: '选项' })))).toContain('invalid-type')
    expect(codes(validateAiContract('rooms', withOptions([{ value: 1, label: 3 }])))).toContain('invalid-type')
    expect(codes(validateAiContract('rooms', withOptions([{ value: 1, label: ' ' }])))).toContain('empty-text')
    expect(codes(validateAiContract('rooms', withOptions([{ label: '缺少取值' }])))).toContain('missing-property')
    expect(codes(validateAiContract('rooms', withOptions([{ value: 1, label: '选项', code: 1 }])))).toContain('unknown-property')
    expect(validateAiContract('rooms', withOptions([]))).toEqual([])
    expect(codes(validateAiContract('rooms', withOptions([]), { profile: 'complete' }))).toContain('empty-section')
  })

  it.each([true, false, null, {}, [], undefined, Infinity, NaN])('拒绝非法枚举取值 %j', value => {
    const contract = fixture()
    const broken = { ...contract, inputs: { keyword: { ...contract.inputs.keyword, options: [{ value, label: '非法选项' }] } } }
    expect(codes(validateAiContract('rooms', broken))).toContain('invalid-option-value')
  })

  it.each([3, '3', '', 0])('相同枚举取值 %j 即使标签不同也不能重复', value => {
    const contract = fixture()
    contract.inputs.keyword!.options = [{ value, label: '第一项' }, { value, label: '第二项' }]
    expect(codes(validateAiContract('rooms', contract))).toContain('duplicate-option-value')
  })

  it.each([
    ['number', '3'], ['string', 3], ['integer', 1.5], ['boolean', 1],
  ])('完整模式拒绝 %s 类型的矛盾选项 %j', (type, value) => {
    const contract = fixture()
    contract.inputs.keyword!.type = String(type)
    contract.inputs.keyword!.options = [{ value: value!, label: '选项' }]
    expect(validateAiContract('rooms', contract)).toEqual([])
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toContain('option-type-mismatch')
  })

  it('拒绝非 JSON 值、循环和稀疏示例数组，允许 JSON null', () => {
    const contract = fixture()
    contract.examples = [{ scenario: '未找到会议室', args: { keyword: '不存在的名称' }, result: null, interpretation: '此处仅验证 JSON 形状，不证明结果与业务 schema 一致。' }]
    expect(validateAiContract('rooms', contract)).toEqual([])
    for (const result of [NaN, 1n, new Date(), () => null, Array(1)]) {
      contract.examples[0]!.result = result
      expect(codes(validateAiContract('rooms', contract))).toContain('not-json')
    }
    const loop: Record<string, unknown> = {}
    loop.self = loop
    contract.examples[0]!.result = loop
    expect(codes(validateAiContract('rooms', contract))).toContain('not-json')
  })

  it('示例存在时必须说明场景、输入、结果和解读', () => {
    expect(codes(validateAiContract('rooms', { ...fixture(), examples: [{ scenario: '查询候选', args: {}, interpretation: '' }] }))).toEqual(expect.arrayContaining(['missing-property', 'empty-text']))
  })

  it('结构合法的缺口不能标为完整，完整模式也检查空主要章节', () => {
    const contract = fixture()
    contract.gaps = ['尚未从真实页面核对枚举单位。']
    contract.consume = []
    expect(validateAiContract('rooms', contract)).toEqual([])
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toEqual(expect.arrayContaining(['incomplete-evidence', 'empty-section']))
  })

  it('完整模式不接受空返回字段和未知结构，void 可明确无返回值', () => {
    const contract = fixture()
    contract.output.fields = []
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toContain('empty-section')
    contract.output.shape = 'unknown[]'
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toContain('unknown-output')
    contract.output.shape = 'void'
    expect(validateAiContract('rooms', contract, { profile: 'complete' })).toEqual([])
  })

  it('迁移期允许有缺口的 unknown 形状或字段；完整模式拒绝冒充完整', () => {
    const contract = fixture()
    contract.output.shape = 'unknown'
    contract.output.fields[0]!.type = 'unknown'
    contract.gaps = ['尚未核实响应根结构和标识字段类型。']
    expect(validateAiContract('rooms', contract)).toEqual([])
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toEqual(expect.arrayContaining(['unknown-output', 'unknown-output-field', 'incomplete-evidence']))
  })

  it('没有额外边界或前置条件时可以明确为空数组', () => {
    const contract = fixture()
    contract.boundaries = []
    contract.prerequisites = []
    expect(validateAiContract('rooms', contract, { profile: 'complete' })).toEqual([])
  })

  it('按真实参数验证覆盖，嵌套字段可以说明根对象参数', () => {
    const contract = fixture()
    contract.inputs = { 'draft.name': { meaning: '申请名称', source: '用户提供', type: 'string', required: true } }
    const definitions = [definition('rooms', false, ['draft', 'date'])]
    expect(validateAiContract('rooms', contract, { definitions })).toEqual([])
    expect(validateAiContract('rooms', contract, { profile: 'complete', definitions })).toEqual([expect.objectContaining({ path: '$.inputs.date', code: 'undocumented-input' })])
  })

  it('真实 required 修改后不能继续发布矛盾说明，未写 required 时仍使用参数定义', () => {
    const contract = fixture()
    const actual = definition('rooms')
    actual.params[0]!.required = false
    expect(validateAiContract('rooms', contract, { definitions: [actual] })).toEqual([])
    expect(validateAiContract('rooms', contract, { profile: 'complete', definitions: [actual] })).toEqual([expect.objectContaining({ path: '$.inputs.keyword.required', code: 'input-required-mismatch' })])
    delete contract.inputs.keyword!.required
    expect(validateAiContract('rooms', contract, { profile: 'complete', definitions: [actual] })).toEqual([])
  })

  it('两侧已声明的 lookup 不能指向不同能力', () => {
    const contract = fixture()
    const actual = definition('rooms')
    actual.params[0]!.lookup = { capabilityId: 'options', keywordParam: 'keyword' }
    contract.inputs.keyword!.lookup = { capabilityId: 'other', args: { keyword: '南楼' }, valueField: 'list[].id', labelField: 'list[].name' }
    const options: Options = { profile: 'complete', definitions: [actual, definition('options'), definition('other')], contracts: { rooms: contract, options: fixture(), other: fixture() } }
    expect(validateAiContract('rooms', contract, options)).toEqual([expect.objectContaining({ path: '$.inputs.keyword.lookup.capabilityId', code: 'input-lookup-mismatch' })])
    contract.inputs.keyword!.lookup.capabilityId = 'options'
    expect(validateAiContract('rooms', contract, options)).toEqual([])
  })

  it('write 与 effect 双向核对，prepare 是只读，写入必须解释防重', () => {
    const contract = fixture()
    contract.effect = 'prepare'
    expect(validateAiContract('rooms', contract, { profile: 'complete', definitions: [definition('rooms')] })).toEqual([])
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete', definitions: [definition('rooms', true)] }))).toContain('effect-mismatch')
    contract.effect = 'write'
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete', definitions: [definition('rooms')] }))).toEqual(expect.arrayContaining(['effect-mismatch', 'missing-idempotency']))
  })

  it('全量检查缺少契约、孤儿契约，支持 Map', () => {
    const contracts = new Map([['rooms', fixture()], ['deleted', fixture()]])
    const definitions = new Map([['rooms', definition('rooms')], ['new', definition('new')]])
    expect(validateAiContracts(contracts, { definitions })).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'new', code: 'missing-contract' }),
      expect.objectContaining({ capabilityId: 'deleted', code: 'unregistered-contract' }),
    ]))
  })

  it('没有下游步骤的能力也必须拥有自己的执行绑定', () => {
    expect(validateAiContracts({ rooms: fixture() }, { definitions: [definition('rooms')], bindings: {} })).toEqual([
      expect.objectContaining({ capabilityId: 'rooms', path: '$.invoke', code: 'missing-binding' }),
    ])
  })

  it('显式 nullable=false 不能与顶层 null 联合类型矛盾，不推测对象内的 null', () => {
    const contract = fixture()
    contract.inputs.keyword!.type = 'string | null'
    contract.inputs.keyword!.nullable = false
    contract.output.fields[0]!.type = 'number | null'
    contract.output.fields[0]!.nullable = false
    expect(validateAiContract('rooms', contract)).toEqual([])
    expect(codes(validateAiContract('rooms', contract, { profile: 'complete' }))).toEqual(['nullable-mismatch', 'nullable-mismatch'])
    contract.inputs.keyword!.nullable = true
    contract.output.fields[0]!.type = 'Record<string, null>'
    expect(validateAiContract('rooms', contract, { profile: 'complete' })).toEqual([])
  })
})

describe('可调用引用与数据消费映射', () => {
  const setup = () => {
    const source = fixture()
    const target = fixture()
    target.inputs = { roomId: { meaning: '会议室主键', source: 'rooms.list[].id' } }
    const options: Options = { profile: 'complete', definitions: [definition('rooms'), definition('reserve', false, ['roomId'])], contracts: { rooms: source, reserve: target }, bindings: { rooms: 'rooms.list', reserve: 'reservation.prepare' }, sdkPaths: ['rooms.list', 'reservation.prepare', 'catalog.describePage'] }
    source.steps = [{ role: 'required', when: '用户选定会议室后准备预定', capabilityId: 'reserve', mapping: { roomId: 'result.list[].id' }, instruction: '取被选候选的 ID，保持数字类型。' }]
    return { source, target, options }
  }

  it('验证真实下一步目标、方向、数组输出与显式输入来源', () => {
    const { source, options } = setup()
    for (const path of ['list[].id', '$.list[].id', 'result.list[].id', 'args.keyword', 'input.keyword', 'user.selectedRoomId', 'context.selectedRoom.id']) {
      source.steps[0]!.mapping = { roomId: path }
      expect(validateAiContract('rooms', source, options), path).toEqual([])
    }
    source.steps[0]!.mapping = { roomId: 'result.list[].missing' }
    expect(codes(validateAiContract('rooms', source, options))).toContain('unknown-source-field')
    source.steps[0]!.mapping = { missingId: 'list[].id' }
    expect(codes(validateAiContract('rooms', source, options))).toContain('unknown-target-input')
  })

  it('动态对象键 * 可匹配具体字段，但普通父对象不等于已说明任意子字段', () => {
    const { source, options } = setup()
    source.output.fields.push({ path: 'assignees.*.id', type: 'number', meaning: '节点键对应的人员 ID' }, { path: 'payload', type: 'object', meaning: '载荷对象' })
    source.steps[0]!.mapping = { roomId: 'result.assignees.nodeA.id' }
    expect(validateAiContract('rooms', source, options)).toEqual([])
    source.steps[0]!.mapping = { roomId: 'result.payload.guessedId' }
    expect(codes(validateAiContract('rooms', source, options))).toContain('unknown-source-field')
  })

  it('动态键可包含数组项和中文字段；数组层级和字段不存在仍拒绝', () => {
    const { source, options } = setup()
    source.output.fields.push({ path: 'assignees.*[].id', type: 'number', meaning: '节点审批人数组中的人员 ID' }, { path: 'variables.费用申请类型', type: 'string', meaning: '本次费用所属申请类型' })
    for (const value of ['result.assignees.nodeA[].id', 'result.assignees.nodeA', 'result.variables.费用申请类型']) {
      source.steps[0]!.mapping = { roomId: value }
      expect(validateAiContract('rooms', source, options), value).toEqual([])
    }
    for (const value of ['result.assignees.nodeA[][].id', 'result.assignees.nodeA[].missing', 'result.variables.不存在的字段']) {
      source.steps[0]!.mapping = { roomId: value }
      expect(codes(validateAiContract('rooms', source, options)), value).toContain('unknown-source-field')
    }
  })

  it('调用目标不能把 $ 当参数名，lookup 参数也不能用根键', () => {
    const { source, target, options } = setup()
    source.steps[0]!.mapping = { $: 'result.list[].id' }
    expect(codes(validateAiContract('rooms', source, options))).toContain('invalid-target-input')
    target.inputs.roomId!.lookup = { capabilityId: 'rooms', args: { $: '南楼' }, valueField: 'list[].id', labelField: 'list[].name' }
    expect(codes(validateAiContract('reserve', target, options))).toContain('invalid-target-input')
  })

  it('未知能力、缺绑定和绑定路径错位都会报告', () => {
    const { source, options } = setup()
    source.steps[0]!.capabilityId = 'removed'
    expect(codes(validateAiContract('rooms', source, options))).toEqual(expect.arrayContaining(['unknown-capability', 'missing-binding']))
    source.steps[0]!.capabilityId = 'reserve'
    source.steps[0]!.sdkPath = 'rooms.list'
    expect(codes(validateAiContract('rooms', source, options))).toEqual(expect.arrayContaining(['binding-mismatch', 'ambiguous-step-target']))
    source.steps[0]!.sdkPath = 'reservation.prepare'
    expect(codes(validateAiContract('rooms', source, options))).toContain('ambiguous-step-target')
  })

  it('步骤角色使用明确词表，有映射的步骤必须指明调用目标', () => {
    const { source, options } = setup()
    source.steps = [{ role: 'required', when: '取选中候选', instruction: '调用对应准备功能', mapping: { roomId: 'result.list[].id' } }]
    expect(codes(validateAiContract('rooms', source, options))).toContain('missing-step-target')
    expect(codes(validateAiContract('rooms', { ...source, steps: [{ ...source.steps[0], role: 'next' }] }, options))).toContain('invalid-enum')
  })

  it('todo 可作为合法默认值、枚举标签、字段、能力 ID 与方法名，不是占位说明', () => {
    const source = fixture()
    source.inputs.keyword!.default = 'todo'
    source.output.fields.push({ path: 'todo', type: 'string', meaning: '当前待办数量对应的显示值', source: 'todo', values: { '1': 'TODO' } })
    source.evidence[0]!.source = 'todo'
    source.steps = [{ role: 'optional', when: '需要读取待办', capabilityId: 'todo', mapping: { keyword: 'todo' }, instruction: '将返回值传给待办筛选参数。' }]
    const options: Options = { profile: 'complete', definitions: [definition('rooms'), definition('todo')], contracts: { rooms: source, todo: fixture() }, bindings: { rooms: 'rooms.list', todo: 'todo' }, sdkPaths: ['rooms.list', 'todo'] }
    expect(validateAiContract('rooms', source, options)).toEqual([])
    delete source.steps[0]!.capabilityId
    source.steps[0]!.sdkPath = 'todo'
    expect(validateAiContract('rooms', source, options)).toEqual([])
    source.inputs.keyword!.default = ''
    expect(validateAiContract('rooms', source, options)).toEqual([])
  })

  it('公共 SDK 路径使用真实方法白名单；无白名单时不假称它不存在', () => {
    const { source, options } = setup()
    source.steps = [{ role: 'optional', when: '需要查看页面说明', sdkPath: 'catalog.describePage', instruction: '传用户选定页面的真实路径。' }]
    expect(validateAiContract('rooms', source, options)).toEqual([])
    source.steps[0]!.sdkPath = 'catalog.noSuchMethod'
    expect(codes(validateAiContract('rooms', source, options))).toContain('unknown-sdk-path')
    expect(validateAiContract('rooms', source, { ...options, sdkPaths: undefined })).toEqual([])
  })

  it('动态返回说明验证真实入口与参数', () => {
    const { source, options } = setup()
    source.output.dynamic = { sdkPath: 'reservation.prepare', args: { roomId: 12 }, instructions: '按返回字段描述继续填写本次可用字段。' }
    expect(validateAiContract('rooms', source, options)).toEqual([])
    source.output.dynamic.args = { inventedId: 12 }
    expect(codes(validateAiContract('rooms', source, options))).toContain('unknown-target-input')
  })

  it('lookup 验证目标参数、值字段与显示字段', () => {
    const { source, target, options } = setup()
    target.inputs.roomId!.lookup = { capabilityId: 'rooms', args: { keyword: '南楼' }, valueField: '$.list[].id', labelField: 'list[].name' }
    expect(validateAiContract('reserve', target, options)).toEqual([])
    target.inputs.roomId!.lookup.labelField = 'list[].label'
    expect(codes(validateAiContract('reserve', target, options))).toContain('unknown-lookup-field')
    target.inputs.roomId!.lookup.args = { query: '南楼' }
    expect(codes(validateAiContract('reserve', target, options))).toContain('unknown-target-input')
    // Invalid output types are issues, never a validator crash while checking references.
    expect(() => validateAiContract('rooms', { ...source, output: { ...source.output, fields: 'broken' } }, options)).not.toThrow()
  })

  it('自然语言映射在完整模式明确未解析，不冒充机器已验', () => {
    const { source, options } = setup()
    source.steps[0]!.mapping = { roomId: '选中会议室的 ID（转数字）' }
    expect(validateAiContract('rooms', source, { ...options, profile: 'structural' })).toEqual([])
    expect(codes(validateAiContract('rooms', source, options))).toContain('unresolved-mapping')
  })

  it('固定映射常量必须使用 literal:<JSON>，合法值不当作字段引用', () => {
    const { source, options } = setup()
    for (const value of ['literal:1', 'literal:"asc"', 'literal:null', 'literal:[]', 'literal:false', 'literal:{"status":1}']) {
      source.steps[0]!.mapping = { roomId: value }
      expect(validateAiContract('rooms', source, options), value).toEqual([])
    }
    source.steps[0]!.mapping = { roomId: '1' }
    expect(codes(validateAiContract('rooms', source, options))).toContain('unresolved-mapping')
  })

  it('固定映射常量拒绝表达式、非法 JSON 和溢出为 Infinity 的数字', () => {
    const { source, options } = setup()
    for (const value of ['literal:process.exit()', 'literal:undefined', 'literal:NaN', 'literal:']) {
      source.steps[0]!.mapping = { roomId: value }
      expect(codes(validateAiContract('rooms', source, options)), value).toContain('invalid-literal')
    }
    for (const value of ['literal:1e999', 'literal:{"nested":[1e999]}']) {
      source.steps[0]!.mapping = { roomId: value }
      expect(codes(validateAiContract('rooms', source, options)), value).toContain('not-json')
    }
  })
})

describe('CLI 同时检查登记能力与方法', () => {
  // An isolated hand-written dist verifies CLI wiring without reading a shared/stale build.
  function runCli(options: { missingMethod?: boolean; missingExport?: boolean; badReference?: boolean } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'portal-ai-contract-cli-'))
    try {
      for (const folder of ['tools/ai-contract', 'dist/capabilities', 'dist/catalog']) mkdirSync(join(root, folder), { recursive: true })
      for (const name of ['check.mjs', 'validate.mjs']) copyFileSync(new URL(`../tools/ai-contract/${name}`, import.meta.url), join(root, 'tools/ai-contract', name))
      writeFileSync(join(root, 'package.json'), '{"type":"module"}')
      writeFileSync(join(root, 'dist/capabilities/index.js'), `export const ALL_CAPABILITY_DEFINITIONS = ${JSON.stringify([definition('rooms')])}`)
      writeFileSync(join(root, 'dist/capabilities/invoke.js'), 'export const CAPABILITY_BINDINGS = [{ capabilityId: "rooms", sdkPath: "rooms.list" }]')
      const method = fixture()
      method.steps = [{ role: 'optional', when: '需要再次检索候选', capabilityId: options.badReference ? 'removed' : 'rooms', mapping: { keyword: 'args.keyword' }, instruction: '用原关键字重新查询候选。' }]
      writeFileSync(join(root, 'dist/catalog/ai-contracts.js'), `export const AI_CONTRACTS = ${JSON.stringify({ rooms: fixture() })}\n${options.missingExport ? '' : `export const METHOD_CONTRACTS = ${JSON.stringify({ 'helper.inspect': method })}`}`)
      writeFileSync(join(root, 'dist/index.js'), `export function createPortalHeadless() { return { rooms: { list() {} }, helper: { ${options.missingMethod ? '' : 'inspect() {}'} } } }`)
      return spawnSync(process.execPath, [join(root, 'tools/ai-contract/check.mjs'), '--complete'], { cwd: root, encoding: 'utf8' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  }

  it('方法无需伪造能力定义；统计登记数且仍检查方法内的能力引用', () => {
    const result = runCli()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('已登记能力 1/1；已登记方法 1')
    expect(result.stdout).toContain('未自动枚举全部未注册公开方法')
    expect(result.stdout).not.toContain('unregistered-contract')
    const broken = runCli({ badReference: true })
    expect(broken.status).toBe(1)
    expect(broken.stdout).toContain('helper.inspect $.steps[0].capabilityId [unknown-capability]')
  })

  it('登记方法自身必须存在真实 SDK 方法，即使契约其他部分完整', () => {
    const result = runCli({ missingMethod: true })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('helper.inspect $.sdkPath [unknown-sdk-path]')
  })

  it('构建产物缺少新版方法注册导出时失败，不回退为仅检查能力', () => {
    const result = runCli({ missingExport: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('METHOD_CONTRACTS')
  })
})
