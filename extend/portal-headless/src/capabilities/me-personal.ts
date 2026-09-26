import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 我的信息 → 个人信息」页面及其“编辑”流程表单。 */
export const ME_PERSONAL_PAGE_PATH = '/dashboard/me/personal/list'
export const ME_PERSONAL_PERMISSION = '/dashboard/me/personal/list'
export const ME_PERSONAL_MODULE_TYPE = 11
export const ME_PERSONAL_FORM_PATH = 'simple/hr/form/025'
export const ME_PERSONAL_PROCESS_KEY = 'staff_info_change'

const STAFF_ROOT = '/org/staff'
const CHANGE_ROOT = '/hr/staff-info-change'

export type MePersonalId = string | number
export type MePersonalJsonObject = Record<string, unknown>

export type MePersonalDetail = MePersonalJsonObject & {
  id: MePersonalId
}

export type MePersonalChangeDraft = MePersonalJsonObject & {
  staffId?: MePersonalId
  id?: MePersonalId
}

export type MePersonalStartUserSelectTask = MePersonalJsonObject & {
  id: string
  name?: string | null
  minSelectCount?: number | null
  maxSelectCount?: number | null
  selectionOrderRequired?: boolean
}

export type MePersonalStartUserSelectAssignees = Record<string, number[]>

export type MePersonalPreparation = {
  draft: MePersonalChangeDraft
  tasks: MePersonalStartUserSelectTask[]
}

export type MePersonalPrepareInput = {
  current: MePersonalDetail
  changes?: MePersonalJsonObject | null
}

export type MePersonalSubmitInput = {
  draft: MePersonalChangeDraft
  tasks: MePersonalStartUserSelectTask[]
  startUserSelectAssignees?: MePersonalStartUserSelectAssignees | null
}

export type MePersonalEditLaunch = {
  path: typeof ME_PERSONAL_FORM_PATH
  processKey: typeof ME_PERSONAL_PROCESS_KEY
  bpmMode: 'edit'
}

export const EDUCATIONAL_ITEM_FIELDS = [
  'startTime', 'endTime', 'school', 'speciality', 'degree', 'academicDegree',
  'educationalSystem', 'learningStyle', 'isFullTime', 'isUnifiedRecruitment',
  'isHighestDegree', 'isFirstDegree', 'degreeFile', 'academicDegreeFile',
  'educationType', 'havingRentalSubsidies', 'rentalFile',
] as const

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const FORM_DRAFT_PARAM = p('draft', 'text', true, 'prepare返回的个人信息变更草稿；不要自己拼接审批人字段')
const TASKS_PARAM = p('tasks', 'text', true, 'prepare返回的发起人自选审批节点数组')
const ASSIGNEES_PARAM = p('startUserSelectAssignees', 'text', false, '按tasks[].id映射审批人ID数组；没有节点时传空映射')

export const mePersonalCapabilities: CapabilityDefinition[] = [
  { id: 'me-personal-get', title: '读取个人信息', write: false, params: [p('staffId', 'number', true, '当前会话用户的员工ID；来自Portal userStore.state.staffId')] },
  { id: 'me-personal-prepare-edit', title: '准备打开个人信息编辑流程', write: false, params: [] },
  { id: 'me-personal-prepare', title: '准备个人信息变更并读取审批人节点', write: false, params: [p('current', 'text', true, 'mePersonal.get返回的完整员工信息'), p('changes', 'text', false, '只覆盖用户明确修改的表单字段')] },
  { id: 'me-personal-submit', title: '提交个人信息变更', write: true, params: [FORM_DRAFT_PARAM, TASKS_PARAM, ASSIGNEES_PARAM] },
  { id: 'me-personal-change-get', title: '读取个人信息变更单', write: false, params: [p('id', 'number', true, '个人信息变更单ID')] },
].map(definition => ({
  ...definition,
  pagePath: ME_PERSONAL_PAGE_PATH,
  permission: ME_PERSONAL_PERMISSION,
  moduleType: ME_PERSONAL_MODULE_TYPE,
  httpInstance: 'platform',
}))

export const ME_PERSONAL_METHODS = {
  'me-personal-get': 'get',
  'me-personal-prepare-edit': 'prepareEdit',
  'me-personal-prepare': 'prepare',
  'me-personal-submit': 'submit',
  'me-personal-change-get': 'getChange',
} as const

function objectOf (value: unknown, label: string): MePersonalJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as MePersonalJsonObject
}

function idOf (value: unknown, label: string): MePersonalId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function listOf (value: unknown, label: string): MePersonalJsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => objectOf(item, `${label}[${index}]`))
}

function stringListOf (value: unknown, label: string): Array<string | number> {
  if (value === undefined || value === null || value === '') return []
  if (typeof value === 'string') return value.split(',')
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组或逗号分隔字符串`)
  return value.map((item, index) => {
    if (typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item))) {
      throw new Error(`${label}[${index}]必须是字符串或数字`)
    }
    return item
  })
}

function validateTextRule (value: unknown, label: string, max: number, required = false, alphaNumeric = false): void {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (value.length > max) throw new Error(`${label}最多输入${max}个字符`)
  if (value.trim() === '') throw new Error(`${label}不能全为空格`)
  if (alphaNumeric && !/^[0-9a-zA-Z]+$/.test(value)) throw new Error(`${label}只能输入数字和字母`)
}

function validateIntegerMin (value: unknown, label: string, minimum: number): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label}必须是大于等于${minimum}的整数`)
  }
}

function validateNestedLists (draft: MePersonalJsonObject): void {
  const educationalList = listOf(draft.educationalList, 'educationalList')
  for (const [index, item] of educationalList.entries()) {
    const label = `educationalList[${index}]`
    validateTextRule(item.school, `${label}.school`, 50, true)
    validateTextRule(item.speciality, `${label}.speciality`, 50, true)
    validateTextRule(item.educationalSystem, `${label}.educationalSystem`, 50)
    validateTextRule(item.learningStyle, `${label}.learningStyle`, 50)
  }

  const workList = listOf(draft.workList, 'workList')
  for (const [index, item] of workList.entries()) {
    const label = `workList[${index}]`
    for (const [field, max] of [['companyName', 50], ['department', 50], ['duties', 50], ['salaryRange', 50], ['description', 200], ['leaveReason', 200]] as const) {
      validateTextRule(item[field], `${label}.${field}`, max)
    }
  }

  const familyList = listOf(draft.familyList, 'familyList')
  for (const [index, item] of familyList.entries()) {
    const label = `familyList[${index}]`
    for (const [field, max] of [['name', 10], ['duties', 50], ['mobile', 15], ['unit', 50], ['education', 50], ['remark', 200]] as const) {
      validateTextRule(item[field], `${label}.${field}`, max)
    }
    validateIntegerMin(item.age, `${label}.age`, 1)
  }

  const professionalList = listOf(draft.professionalList, 'professionalList')
  for (const [index, item] of professionalList.entries()) {
    const label = `professionalList[${index}]`
    for (const [field, max] of [['type', 50], ['name', 50], ['level', 20], ['code', 20], ['highestLevel', 20], ['unit', 50], ['remark', 200]] as const) {
      validateTextRule(item[field], `${label}.${field}`, max, false, field === 'code')
    }
  }

  const positionalList = listOf(draft.positionalList, 'positionalList')
  for (const [index, item] of positionalList.entries()) {
    const label = `positionalList[${index}]`
    for (const [field, max] of [['name', 50], ['level', 20], ['reviewMethod', 20], ['unit', 50], ['code', 20]] as const) {
      validateTextRule(item[field], `${label}.${field}`, max, false, field === 'code')
    }
    // Portal 的 positionalList.remark 只有 textarea，没有 :rules；故意不加长度或空格校验。
  }
}

function mapEducationalItems (value: unknown): MePersonalJsonObject[] {
  return listOf(value, 'educationalList').map(item => Object.fromEntries(
    EDUCATIONAL_ITEM_FIELDS.map(field => [field, item[field] ?? null]),
  ))
}

function normalizeContractItems (value: unknown): MePersonalJsonObject[] {
  return listOf(value, 'contractList').map(item => {
    const contract = { ...item }
    if (Number(contract.termType) === 2) delete contract.endTime
    return contract
  })
}

function normalizeSeniority (value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function normalizeUndefinedToNull (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeUndefinedToNull)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as MePersonalJsonObject).map(([key, item]) => [key, normalizeUndefinedToNull(item)]))
  }
  return value === undefined ? null : value
}

function prepareDraft (input: MePersonalPrepareInput): MePersonalChangeDraft {
  const current = objectOf(input?.current, '个人信息当前详情')
  const changes = input?.changes === undefined || input?.changes === null ? {} : objectOf(input.changes, '个人信息变更字段')
  const merged: MePersonalJsonObject = { ...current, ...changes }
  const staffId = idOf(merged.staffId ?? merged.id, 'staffId')

  merged.staffId = staffId
  merged.staffDuties = stringListOf(merged.staffDuties, 'staffDuties').join(',')
  merged.otherPosts = stringListOf(merged.otherPosts, 'otherPosts').join(',')
  merged.workList = listOf(merged.workList, 'workList')
  merged.familyList = listOf(merged.familyList, 'familyList')
  merged.professionalList = listOf(merged.professionalList, 'professionalList')
  merged.positionalList = listOf(merged.positionalList, 'positionalList')
  merged.educationalList = mapEducationalItems(merged.educationalList)
  merged.contractList = normalizeContractItems(merged.contractList)

  // 普通编辑分支把详情里的展示字段 otherOrganizationInfoList 映射成
  // formState.otherOrganizationList，随后随 ...formState 一起提交。
  if (Object.prototype.hasOwnProperty.call(changes, 'otherOrganizationList')) {
    merged.otherOrganizationList = listOf(merged.otherOrganizationList, 'otherOrganizationList')
  } else {
    merged.otherOrganizationList = listOf(
      current.otherOrganizationInfoList ?? merged.otherOrganizationList,
      'otherOrganizationList',
    )
  }

  const beforeEntry = normalizeSeniority(merged.seniorityBeforeEntry)
  const entry = normalizeSeniority(merged.entrySeniority)
  merged.seniorityBeforeEntry = beforeEntry
  merged.entrySeniority = entry
  merged.totalSeniority = beforeEntry + entry

  validateNestedLists(merged)
  return normalizeUndefinedToNull(merged) as MePersonalChangeDraft
}

function tasksOf (value: unknown): MePersonalStartUserSelectTask[] {
  if (!Array.isArray(value)) throw new Error('个人信息审批人节点响应必须是数组')
  return value.map((raw, index) => {
    const task = objectOf(raw, `个人信息审批人节点[${index}]`)
    if (typeof task.id !== 'string' || task.id.trim() === '') throw new Error(`个人信息审批人节点[${index}].id不能为空`)
    return task as MePersonalStartUserSelectTask
  })
}

function assigneesOf (value: unknown, tasks: readonly MePersonalStartUserSelectTask[]): MePersonalStartUserSelectAssignees {
  const input = value === undefined || value === null ? {} : objectOf(value, 'startUserSelectAssignees')
  const taskIds = new Set(tasks.map(task => task.id))
  for (const key of Object.keys(input)) if (!taskIds.has(key)) throw new Error(`startUserSelectAssignees包含未知节点${key}`)

  const result: MePersonalStartUserSelectAssignees = {}
  for (const task of tasks) {
    const raw = input[task.id]
    if (raw === undefined) {
      if ((task.minSelectCount ?? 0) > 0) throw new Error(`审批节点${task.name ?? task.id}至少需要选择${task.minSelectCount}人`)
      result[task.id] = []
      continue
    }
    if (!Array.isArray(raw)) throw new Error(`审批节点${task.name ?? task.id}的审批人必须为数组`)
    const ids = raw.map((id, index) => idOf(id, `startUserSelectAssignees.${task.id}[${index}]`))
    const numericIds = ids.map(id => Number(id))
    if (new Set(numericIds).size !== numericIds.length) throw new Error(`审批节点${task.name ?? task.id}不能重复选择同一审批人`)
    if (task.minSelectCount !== null && task.minSelectCount !== undefined && ids.length < task.minSelectCount) throw new Error(`审批节点${task.name ?? task.id}至少需要选择${task.minSelectCount}人`)
    if (task.maxSelectCount !== null && task.maxSelectCount !== undefined && ids.length > task.maxSelectCount) throw new Error(`审批节点${task.name ?? task.id}最多选择${task.maxSelectCount}人`)
    result[task.id] = numericIds
  }
  return result
}

export function createMePersonalCapability (request: PortalRequest) {
  return {
    async get (input: { staffId: MePersonalId }): Promise<MePersonalDetail> {
      const staffId = idOf(input?.staffId, 'staffId')
      const result = objectOf(await request({ url: `${STAFF_ROOT}/${staffId}`, method: 'get' }), '个人信息响应')
      return { ...result, id: idOf(result.id, '个人信息ID') }
    },

    prepareEdit (): MePersonalEditLaunch {
      return { path: ME_PERSONAL_FORM_PATH, processKey: ME_PERSONAL_PROCESS_KEY, bpmMode: 'edit' }
    },

    async prepare (input: MePersonalPrepareInput): Promise<MePersonalPreparation> {
      const draft = prepareDraft(input)
      const tasks = tasksOf(await request({ url: `${CHANGE_ROOT}/getRequiredStartUserSelectTasks`, method: 'post', data: draft }))
      return { draft, tasks }
    },

    async submit (input: MePersonalSubmitInput): Promise<MePersonalId> {
      const draft = prepareDraft({ current: input?.draft as unknown as MePersonalDetail })
      const tasks = tasksOf(input?.tasks)
      const startUserSelectAssignees = assigneesOf(input?.startUserSelectAssignees, tasks)
      const result = await request<unknown>({
        url: `${CHANGE_ROOT}/create`,
        method: 'post',
        data: { ...draft, startUserSelectAssignees },
      })
      return idOf(result, '个人信息变更单返回ID')
    },

    async getChange (input: { id: MePersonalId }): Promise<MePersonalJsonObject> {
      const id = idOf(input?.id, '个人信息变更单ID')
      return objectOf(await request({ url: `${CHANGE_ROOT}/get`, method: 'get', params: { id } }), '个人信息变更单响应')
    },
  }
}

export type MePersonalCapability = ReturnType<typeof createMePersonalCapability>
