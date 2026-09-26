import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { MEETING_ROOM_METHODS, MEETING_ROOM_PAGE_PATH, MEETING_ROOM_PERMISSION, meetingRoomCapabilities } from '../capabilities/meeting-room.js'

const definitions = new Map(meetingRoomCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/meeting-room/list.vue、app/portal/components/portal/modal-form/index.vue', kind: 'reference', note: '逐页核对菜单路径、权限、列表筛选、ModalForm字段、删除状态门禁和启停请求。' },
  { source: 'MeetingRoomController.java、MeetingRoomSaveReqVO.java、MeetingRoomServiceImpl.java', kind: 'reference', note: '核对会议室CRUD、启停端点、请求体校验、启用中禁止删除和true/Long响应。' },
  { source: 'src/capabilities/meeting-room.ts、test/meeting-room.test.ts', kind: 'implementation', note: '锁定SDK请求路径、查询参数、状态门禁、表单归一化、严格响应校验和反证测试。' },
  { source: 'docs/pages/会议室列表.md', kind: 'reference', note: '记录页面能力、字段基准、操作步骤和验证边界。' },
]

const boundaries = [
  `页面范围是${MEETING_ROOM_PAGE_PATH}，菜单权限是${MEETING_ROOM_PERMISSION}；请求使用Portal会议室对应的HR服务上下文，不附加无证据的module-type。`,
  '会议室维护与会议预定是两条业务线；本组只覆盖会议室主数据维护，会议室占用查询仍走meeting-application。',
  'name必须非空且最多50个字符，authorizedOrgId必须是当前会话可见组织ID；SDK不替调用方绕过组织权限。',
  '删除前必须以最新列表行确认status=0禁用；启停提交按Portal规则把当前status取反，不能直接伪造目标状态。',
]

const common = (id: string, purpose: string, effect: AiContract['effect'], inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], steps: AiContract['steps'], completion: string, idempotency: string | null = null): AiContract => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`会议室契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect,
    prerequisites: ['使用当前用户会话和当前租户；调用方必须拥有会议室列表菜单权限，ID和组织候选必须来自当前会话可见数据。'],
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: ['表单、状态门禁、组织权限、后端业务校验、网络或响应形状错误会抛出；HTTP成功不替代回查。'],
    idempotency,
    evidence,
    gaps: ['已完成Portal/Java静态逐页核对与离线请求测试；尚未在真实测试环境执行本页浏览器读请求及写入prepare→submit→cancel闭环。'],
  }
}

const idInput = param('会议室ID；来自当前列表的list[].id。', 'meeting-room-list.result.list[].id', { type: 'string | number', required: true })
const formInput = param('Portal表单对象；新建包含name、authorizedOrgId，编辑另含id。', '用户填写的会议室ModalForm', { type: 'object', required: true })
const draftInput = param('对应prepare能力返回的草稿；按Portal字段原样提交。', '对应prepare.result.draft', { type: 'object', required: true })
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'boolean', '后端成功标志，必须严格为true。', { optional: false, nullable: false })], empty: '响应不是true时抛错。' }

const contracts: Record<string, AiContract> = {
  'meeting-room-list': common('meeting-room-list', '分页查询会议室主数据列表。', 'read', {
    name: param('会议室名称模糊筛选。', 'Portal列表筛选框', { type: 'string', required: false, omitted: '发送空字符串' }),
    authorizedOrgId: param('授权组织ID；长选项必须先通过部门候选确定。', 'base-dept-search 返回的部门候选或Portal授权组织选择器', { type: 'string | number', required: false, nullable: true, omitted: '不发送该筛选', lookup: { capabilityId: 'base-dept-search', args: { keyword: '$keyword' }, valueField: 'list[].id', labelField: 'list[].name' } }),
    pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'number', required: false, default: '1' }),
    pageSize: param('每页条数。', 'Portal分页状态', { type: 'number', required: false, default: '10' }),
    order: param('排序方向；按Portal列表请求原样传入。', 'Portal列表排序状态', { type: 'string', required: false, omitted: '发送空字符串' }),
    orderField: param('排序字段；按Portal列表请求原样传入。', 'Portal列表排序状态', { type: 'string', required: false, omitted: '发送空字符串' }),
  }, { shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '当前页会议室记录'), field('list[].id', 'string | number', '会议室主键'), field('list[].name', 'string', '会议室名称'), field('list[].authorizedOrgId', 'string | number | null', '授权组织ID', { nullable: true }), field('list[].status', '0 | 1 | null', '会议室状态；0禁用、1启用', { nullable: true, values: { '0': '禁用', '1': '启用' } }), field('total', 'number', '筛选结果总数')], empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应结构错误会抛出。' }, ['用list[].id继续get、编辑、删除或启停；删除和启停前必须使用最新status。', '列表不表示可用时间；预订前必须另查meeting-room-usage并按时间段判断冲突。'], [{ role: 'optional', when: '用户已选定会议室并要进入预订表单', capabilityId: 'meeting-application-prepare', mapping: { meetingRoomId: 'result.list[].id' }, instruction: '只把用户选中的list[].id填入meetingRoomId；完整会议草稿仍需补齐名称、起止时间和人数。' }], '返回当前筛选的一页及总数。'),
  'meeting-room-get': common('meeting-room-get', '读取单个会议室编辑详情。', 'read', { id: idInput }, { shape: 'object', fields: [field('id', 'string | number', '会议室ID'), field('name', 'string', '会议室名称'), field('authorizedOrgId', 'string | number', '授权组织ID'), field('status', '0 | 1 | null', '当前状态', { nullable: true })], empty: '找不到记录或响应不是对象时抛错。' }, ['将详情作为prepareUpdate的form，不要只凭列表展示字段覆盖保存。'], [], '获得可编辑会议室对象。'),
  'meeting-room-prepare-create': common('meeting-room-prepare-create', '按Portal新建ModalForm规则校验并生成会议室草稿，不发请求。', 'prepare', { form: formInput }, { shape: '{ draft: { name: string, authorizedOrgId: string | number } }', fields: [field('draft.name', 'string', '名称，非空且最多50个字符'), field('draft.authorizedOrgId', 'string | number', '授权组织ID')], empty: '表单非法时抛错且不发请求。' }, ['向用户展示draft；确认后交给create，取消时丢弃。'], [{ role: 'required', when: '用户确认新建', capabilityId: 'meeting-room-create', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给create。' }, { role: 'cancel', when: '用户取消新建', capabilityId: 'meeting-room-cancel-create', mapping: { draft: 'result.draft' }, instruction: '丢弃draft，不发请求。' }], '得到未写入的会议室新建草稿。'),
  'meeting-room-create': common('meeting-room-create', '按Portal新建表单创建会议室。', 'write', { draft: draftInput }, { shape: 'string | number', fields: [field('$', 'string | number', '新建会议室主键。', { optional: false, nullable: false })], empty: '响应不是正整数ID时抛错。' }, ['返回ID后重新list/get核对name、authorizedOrgId和status；不要只凭ID宣布完成。'], [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'meeting-room-list', instruction: '回查列表或详情确认记录落库。' }, { role: 'cancel', when: '用户在prepare阶段取消', capabilityId: 'meeting-room-cancel-create', instruction: '提交前取消只丢弃草稿；已提交后无Portal撤销接口。' }], '请求未抛错且回查确认记录存在。', '后端没有requestId；响应不确定时先回查再决定是否重试。'),
  'meeting-room-cancel-create': common('meeting-room-cancel-create', '取消尚未提交的会议室新建草稿。', 'local', { draft: draftInput }, { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true')], empty: '不发请求。' }, ['丢弃draft；再次新建需重新prepare。'], [], '返回cancelled=true且没有HTTP请求。'),
  'meeting-room-prepare-update': common('meeting-room-prepare-update', '按Portal编辑ModalForm规则校验并生成会议室编辑草稿，不发请求。', 'prepare', { form: formInput }, { shape: '{ draft: { id, name, authorizedOrgId } }', fields: [field('draft.id', 'string | number', '会议室ID'), field('draft.name', 'string', '名称，非空且最多50个字符'), field('draft.authorizedOrgId', 'string | number', '授权组织ID')], empty: '表单非法时抛错且不发请求。' }, ['确认后交给update；取消时丢弃。'], [{ role: 'required', when: '用户确认编辑', capabilityId: 'meeting-room-update', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给update。' }, { role: 'cancel', when: '用户取消编辑', capabilityId: 'meeting-room-cancel-update', mapping: { draft: 'result.draft' }, instruction: '丢弃draft，不发请求。' }], '得到未写入的编辑草稿。'),
  'meeting-room-update': common('meeting-room-update', '按Portal编辑表单保存会议室。', 'write', { draft: draftInput }, trueOutput, ['成功或响应不确定时回查同一ID，核对name、authorizedOrgId及status。'], [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'meeting-room-get', mapping: { id: 'args.draft' }, instruction: '从同一份draft中提取id，回查详情确认字段一致。' }, { role: 'cancel', when: '用户在prepare阶段取消', capabilityId: 'meeting-room-cancel-update', instruction: '提交前取消只丢弃草稿。' }], '请求返回true且回查确认字段一致。'),
  'meeting-room-cancel-update': common('meeting-room-cancel-update', '取消尚未提交的会议室编辑草稿。', 'local', { draft: draftInput }, { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true')], empty: '不发请求。' }, ['丢弃draft。'], [], '返回cancelled=true。'),
  'meeting-room-prepare-delete': common('meeting-room-prepare-delete', '确认会议室处于禁用状态并生成删除草稿，不发请求。', 'prepare', { id: idInput, currentStatus: param('当前列表行状态；必须为0禁用。', 'meeting-room-list.result.list[].status', { type: '0', required: true, options: [{ value: 0, label: '禁用' }] }) }, { shape: '{ draft: { id } }', fields: [field('draft.id', 'string | number', '待删除会议室ID')], empty: '状态不是0或ID非法时抛错。' }, ['只对最新列表行执行；确认后交给delete。'], [{ role: 'required', when: '用户确认删除', capabilityId: 'meeting-room-delete', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给delete。' }, { role: 'cancel', when: '用户取消删除', capabilityId: 'meeting-room-cancel-delete', mapping: { draft: 'result.draft' }, instruction: '丢弃draft。' }], '得到通过禁用状态门禁的删除草稿。'),
  'meeting-room-delete': common('meeting-room-delete', '删除一个已禁用的会议室。', 'write', { draft: draftInput }, trueOutput, ['成功后重新list/get确认记录不存在；启用状态的删除会先在prepare阶段阻止。'], [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'meeting-room-list', instruction: '回查确认记录已删除；不要只凭true响应宣布完成。' }, { role: 'cancel', when: '用户在prepare阶段取消', capabilityId: 'meeting-room-cancel-delete', instruction: '提交前取消只丢弃草稿。' }], '请求返回true且回查确认记录消失。'),
  'meeting-room-cancel-delete': common('meeting-room-cancel-delete', '取消尚未提交的会议室删除草稿。', 'local', { draft: draftInput }, { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true')], empty: '不发请求。' }, ['丢弃draft。'], [], '返回cancelled=true。'),
  'meeting-room-prepare-update-status': common('meeting-room-prepare-update-status', '按Portal启停按钮将会议室当前状态取反，生成启停草稿，不发请求。', 'prepare', { id: idInput, currentStatus: param('当前列表行状态；0禁用或1启用。', 'meeting-room-list.result.list[].status', { type: '0 | 1', required: true, options: [{ value: 0, label: '禁用' }, { value: 1, label: '启用' }] }) }, { shape: '{ draft: { id, status }, previous: { id, status } }', fields: [field('draft.id', 'string | number', '会议室ID'), field('draft.status', '0 | 1', '取反后的目标状态'), field('previous.status', '0 | 1', '提交前状态')], empty: '状态或ID非法时抛错。' }, ['确认后交给updateStatus；取消时丢弃。'], [{ role: 'required', when: '用户确认启停', capabilityId: 'meeting-room-update-status', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给updateStatus。' }, { role: 'cancel', when: '用户取消启停', capabilityId: 'meeting-room-cancel-update-status', mapping: { draft: 'result.draft' }, instruction: '丢弃draft。' }], '得到取反后的启停草稿。'),
  'meeting-room-update-status': common('meeting-room-update-status', '按Portal启停动作更新会议室状态。', 'write', { draft: draftInput }, trueOutput, ['请求为PUT /hr/meeting-room/update-status/{id}?status=目标状态，body为null；成功后回查列表确认status。'], [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'meeting-room-list', instruction: '回查同一ID确认目标状态。' }, { role: 'cancel', when: '用户在prepare阶段取消', capabilityId: 'meeting-room-cancel-update-status', instruction: '提交前取消只丢弃草稿。' }], '请求返回true且回查确认目标状态。'),
  'meeting-room-cancel-update-status': common('meeting-room-cancel-update-status', '取消尚未提交的会议室启停草稿。', 'local', { draft: draftInput }, { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true')], empty: '不发请求。' }, ['丢弃draft。'], [], '返回cancelled=true。'),
}

export const MEETING_ROOM_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(MEETING_ROOM_METHODS).map(id => [id, contracts[id]!]),
)
export const MEETING_ROOM_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(MEETING_ROOM_METHODS).map(([id, method]) => [
    `meetingRoom.${method}`,
    { ...MEETING_ROOM_AI_CONTRACTS[id]!, boundaries: [...MEETING_ROOM_AI_CONTRACTS[id]!.boundaries, `直接方法路径为meetingRoom.${method}；写操作保持prepare→submit→cancel。`] },
  ]),
)
