import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  APPLICANT_PAGE_SIZE_DEFAULT,
  APPLICANT_PAGE_SIZE_MAX,
  APPLICANT_PICKER_URL,
  DESTINATION_MAX,
  ORG_ROOT_MAX,
  REASON_MAX,
  REMARK_MAX,
  REQUIRED_TASKS_URL,
  VEHICLE_APPLICATION_FORM_PATH,
  VEHICLE_APPLICATION_MY_LIST_PATH,
  VEHICLE_APPLICATION_PAGE_PATH,
  VEHICLE_APPLICATION_PROCESS_KEY,
  VEHICLE_APPLICATION_PROCESS_TYPE,
  assertApplicantResolvable,
  assertApproversNotSelf,
  assertAssigneesForTasks,
  assertDataComplete,
  assertTimeOrder,
  buildVehicleApplicationPayload,
  createVehicleApplicationCapability,
  findSelfApproverConflicts,
  isActiveStaffStatus,
  vehicleApplicationCapabilities,
  type VehicleApplicationDraft,
} from '../src/capabilities/vehicle-application.js'

/**
 * 用车申请（`vehicle_usage_application` / `/simple/hr/form/031`）—— 流程表单第三条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/vehicle-application.browser.json`：真实浏览器抓的请求
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/031/**`（**注意**：
 *      `Projects_Js` 本地 checked-out 的那个分支对**申请人选择器**是旧的，
 *      测试环境上跑的是 `test/portal/main` 分支的 `getStaffByOrgPage` 版本 ——
 *      以基准文件里那条**实测**为准，见能力文件头 §三）
 *   3. 后端源码 `VehicleUsageApplicationController` /
 *      `VehicleUsageApplicationServiceImpl` / `BpmTaskServiceImpl`
 *
 * 写链路（submit / cancel）的真实往返记录在 `docs/pages/用车申请.md` 的
 * 「真实验证记录」一节；这里只管契约与逐字段一致。
 */

type BaselineRequest = {
  于: string
  u: string
  via: string
  headers: Record<string, string>
  次数?: number
  body?: string
}
type Baseline = {
  入口: string
  请求: BaselineRequest[]
  表单填写值: Record<string, string>
  '提交载荷（从上面那条 preview 的 variables 里原样摘出来，键顺序即序列化顺序）': Record<string, string>
} & Record<string, unknown>

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/vehicle-application.browser.json'), 'utf8'),
) as Baseline

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))

/** 基准里 `getTemporaryRequiredStartUserSelectTasks` 那条 POST */
const baselineTasksRequest = baseline.请求.find((r) =>
  r.u.includes('/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks'),
)
/** 基准里 `getStaffByOrgPage` 那条 POST（页面发了 3 次，body 只差 selectedStaffIds） */
const baselinePickerRequest = baseline.请求.find((r) => r.u.includes('/staff/getStaffByOrgPage'))
/** 基准里 preview 那条（它的 variables 就是提交载荷） */
const baselinePreviewRequest = baseline.请求.find((r) => r.u.includes('/bpm/process-instance/preview'))

/** 基准里那条「按组织分页查」的整个 body（原样，用于逐字节对照） */
const baselinePickerBody = baselinePickerRequest?.body as string

/** 基准里那份「提交载荷」的键名（形如 `提交载荷（…）`，含全角括号，只能用下标取） */
const PAYLOAD_KEY = '提交载荷（从上面那条 preview 的 variables 里原样摘出来，键顺序即序列化顺序）'
const BASELINE_PAYLOAD = baseline[PAYLOAD_KEY] as Record<string, string>

/** 基准里那三个自选节点的 id（从 preview 的 startUserSelectAssignees 键里取） */
const REAL_TASK_IDS = Object.keys(
  (JSON.parse(baselinePreviewRequest?.body ?? '{}') as {
    startUserSelectAssignees?: Record<string, unknown>
  }).startUserSelectAssignees ?? {},
)

/** 基准里那三个节点的完整形状（另一次只读实测，原样记在基准文件的「审批人节点」一节） */
const tasksKey = Object.keys(baseline).find((key) => key.startsWith('审批人节点')) as string
const REAL_TASKS = (baseline[tasksKey] as { data: Array<Record<string, unknown>> }).data

/**
 * 与基准同一份表单填写值。**写死**而不是从基准里读 —— 基准是"浏览器发出去的"，
 * 这里是"SDK 发出去的"，两边各自独立取值才叫对照；下面那条
 * «写死的填写值与基准里记的一致» 负责兜住两边漂移。
 */
const draft: VehicleApplicationDraft = {
  staffId: '1163',
  staffName: '姚淼鑫',
  reason: 'SDK-TEST-baseline 用车事由（浏览器基准抓取，不会提交）',
  startTime: '2026-09-22 09:00:00',
  endTime: '2026-09-22 15:00:00',
  destination: 'SDK-TEST-baseline 目的地',
  remark: '',
}

/**
 * 两个 userId，全程用来做「本人 / 别人」的对照。
 *
 * `SELF` 是测试账号的 userId（实测 `/system/user/info` 的 `id` = 18243）；
 * `OTHER` 是随便一个别的用户 id（**不是** 18243 就行，它只在这个文件里当"别人"用）。
 * ⚠️ 它们都是 **userId**，不是申请人的 **staffId**（那是 1163）—— 这条区分是本流程的关键。
 */
const SELF = 18243
const OTHER = 197832

/** 三个节点各选一个人的合法组合（"别人"，不会触发本人自动通过） */
const OTHER_ASSIGNEES = {
  Activity_0yx86ms: [OTHER],
  Activity_0q8l1yc: [OTHER],
  Activity_0viq4cx: [OTHER],
}

/** 真实的组织树形状（实测：顶层只有 34「沃德辰龙」，它有 10 个孩子） */
const ORG_TREE = [
  {
    id: '34',
    name: '沃德辰龙',
    children: [
      { id: '35', name: '华都峪口' },
      { id: '36', name: '北京思玛特' },
      { id: '37', name: '沃德博创' },
      { id: '71', name: '天津沃德' },
      { id: '467', name: '华裕食品公司' },
      { id: '3997', name: '北京沃德' },
      { id: '4026', name: '职能部室' },
      { id: '4094', name: '投资公司' },
      { id: '4099', name: '合伙企业' },
      { id: '4111', name: '峪禽职业学校' },
    ],
  },
]

function makeSdk (respond: (config: InternalAxiosRequestConfig) => unknown) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: respond(config) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  // 组装点（src/index.ts）将来也是这样接的：能力收一个"已带页面上下文"的请求函数
  const capability = createVehicleApplicationCapability((requestConfig) =>
    sdk.call(VEHICLE_APPLICATION_FORM_PATH, requestConfig),
  )
  return { sdk, calls, capability }
}

/** 默认后端：组织树 + 三个自选节点；别的都回 {} */
function fakeBackend () {
  return (config: InternalAxiosRequestConfig): unknown => {
    const url = String(config.url)
    if (url.includes('/org/organization/getRoleOrganizationTree')) return ORG_TREE
    if (url.includes('/getTemporaryRequiredStartUserSelectTasks')) return REAL_TASKS
    if (url.includes(APPLICANT_PICKER_URL)) {
      return { list: [], total: 0, selectedItems: [] }
    }
    return {}
  }
}

function captureSdk (respond = fakeBackend()) {
  return makeSdk(respond)
}

/** axios 在到达 adapter 前已按 transformRequest 把对象序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

function pathOf (config: InternalAxiosRequestConfig | undefined): string {
  return normalize(String(config?.url ?? '')).split('?')[0] as string
}

/**
 * 取这次请求的查询参数（**顺序即 qs 序列化后的顺序**）。
 *
 * ⚠️ 不能读 `config.params`：走到自定义 adapter 时 axios 已经把 params 折进
 * `config.url` 并把 `config.params` 清成 `{}`（实测）。所以只能从 URL 里解析回来。
 */
function queryMapOf (config: InternalAxiosRequestConfig | undefined): Record<string, string> {
  const query = String(config?.url ?? '').split('?')[1] ?? ''
  if (query === '') return {}
  return Object.fromEntries(
    query.split('&').map((part) => {
      const index = part.indexOf('=')
      const key = index === -1 ? part : part.slice(0, index)
      const value = index === -1 ? '' : part.slice(index + 1)
      return [key, key === '_t' ? '<ts>' : decodeURIComponent(value)]
    }),
  )
}

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('用车申请 —— 读链路与浏览器基准一致', () => {
  it('写死的表单填写值与基准里记的一致（两边不会各自漂移）', () => {
    expect(draft.staffId).toBe(baseline.表单填写值.staffId)
    expect(draft.staffName).toBe(baseline.表单填写值.staffName)
    expect(draft.reason).toBe(baseline.表单填写值.reason)
    expect(draft.startTime).toBe(baseline.表单填写值.startTime)
    expect(draft.endTime).toBe(baseline.表单填写值.endTime)
    expect(draft.destination).toBe(baseline.表单填写值.destination)
    expect(draft.remark).toBe(baseline.表单填写值.remark)
  })

  it('流程定义请求与基准一致（key 是 vehicle_usage_application）', async () => {
    const { calls, capability } = captureSdk()
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe(
      '/admin-api/bpm/process-definition/get?key=vehicle_usage_application&_t=<ts>',
    )
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('prepare 打的审批人节点接口是 getTemporary… 那个变体，不是 getRequired…', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const actual = String(calls.find((c) => pathOf(c).endsWith('/getTemporaryRequiredStartUserSelectTasks'))?.url)
    expect(actual).not.toBe('')
    expect(normalize(actual)).toBe(`/admin-api${REQUIRED_TASKS_URL}`)
    // 两个变体后端都写了（实测都能通）；浏览器用的是 Temporary，SDK 必须跟前端走
    expect(calls.some((c) => pathOf(c).endsWith('/getRequiredStartUserSelectTasks'))).toBe(false)
  })

  it('★ 把基准那条 body 的四个业务值替换成填写值后，与 SDK 的载荷**逐字节**相同', () => {
    // 基准那条 body 的 reason/startTime/endTime/destination 全是空串（挂载时发的），
    // 而 SDK 的载荷构造会先拦下空值 —— 所以不能直接拿它当整体对照。
    // 这里做的是**同一个模板**上的对照：把基准 body 里那四个值换成填写的值，
    // 逐字节必须与 SDK 产出的完全一样（键顺序、字符串 staffId、空 remark 全在内）。
    const baselineJson = baselineTasksRequest?.body as string
    const expected = baselineJson
      .replace('"reason":""', `"reason":${JSON.stringify(draft.reason)}`)
      .replace('"startTime":""', `"startTime":${JSON.stringify(draft.startTime)}`)
      .replace('"endTime":""', `"endTime":${JSON.stringify(draft.endTime)}`)
      .replace('"destination":""', `"destination":${JSON.stringify(draft.destination)}`)

    const actual = JSON.stringify(buildVehicleApplicationPayload(draft))
    expect(actual).toBe(expected)
    // 那四个值确实被替换到了（否则上面那条就是空转）
    expect(expected).not.toBe(baselineJson)
    expect(Object.keys(JSON.parse(actual))).toEqual(Object.keys(JSON.parse(baselineJson)))
    expect(actual).not.toContain('attachments')
    expect(actual).not.toContain('"id"')
  })

  it('★ prepare 的请求体 = 基准那条 body 的字段与键顺序（填满后），且**不发**基准里那条空载荷', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const tasksCall = calls.find((c) => pathOf(c).endsWith('/getTemporaryRequiredStartUserSelectTasks'))
    const body = JSON.parse(rawBodyOf(tasksCall))
    // 键顺序与基准完全一致，只是值被填满了
    expect(Object.keys(body)).toEqual(Object.keys(JSON.parse(baselineTasksRequest?.body as string)))
    expect(body).toEqual(BASELINE_PAYLOAD)
  })

  it('★★ 基准里那条 body（字段全空）后端会 400，所以 SDK **拒绝**它、一个请求都不发', async () => {
    // 这是一处**刻意的偏离**，理由是一条只读实测：后端
    // getTemporaryRequiredStartUserSelectTasks 的参数带 @Valid，字段不全直接 400：
    //   全空 → 400 请求参数不正确:结束时间不能为空
    //   只缺 reason → 400 请求参数不正确:用车事由不能为空
    // 页面挂载时那一次 refreshApprovalTasks() 用的闸是 canRefresh…（只看选不选得到人），
    // 所以它**真的发了**、也**真的被拒了** —— 页面上那三个审批人下拉因此是失败态。
    const baselineBody = JSON.parse(baselineTasksRequest?.body as string)
    expect(baselineBody.reason).toBe('')
    expect(baselineBody.startTime).toBe('')
    expect(baselineBody.destination).toBe('')

    const { calls, capability } = captureSdk()
    await expect(
      capability.prepare({
        staffId: '1163',
        staffName: '姚淼鑫',
        reason: '',
        startTime: '',
        endTime: '',
        destination: '',
        remark: '',
      }),
    ).rejects.toThrow(/都齐了才能问审批人节点/)
    expect(calls).toHaveLength(0)
  })

  it('prepare 的请求头与基准同一个集合，且**不发 module-type**', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const tasksCall = calls.find((c) => pathOf(c).endsWith('/getTemporaryRequiredStartUserSelectTasks'))
    const actual = tasksCall?.headers as unknown as Record<string, string>
    const expected = baselineTasksRequest?.headers as Record<string, string>
    expect(actual['tenant-id']).toBe(expected['tenant-id'])
    expect(actual['Accept-Language']).toBe(expected['Accept-Language'])
    expect(actual['Accept']).toBe(expected['Accept'])
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
    expect(actual).not.toHaveProperty('module-type')
  })

  it('三条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', () => {
    for (const path of [
      VEHICLE_APPLICATION_FORM_PATH,
      VEHICLE_APPLICATION_PAGE_PATH,
      VEHICLE_APPLICATION_MY_LIST_PATH,
    ]) {
      expect(createPortalHeadless({
        baseUrl: 'https://biz-api-test.wodecorp.cn',
        credential: { token: 'tk-test', tenantId: 1 },
      }).resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('基准本身记录了页面「无关键字拉 9 页 × 500 人」的行为（D6 的由来）', () => {
    const pull = baseline.请求.find((r) => r.u.includes('/system/user/simple-page'))
    expect(pull).toBeDefined()
    expect(pull?.u).toContain('pageSize=500')
    expect(pull?.u).not.toContain('nickname=')
    expect(pull?.次数).toBe(9)
  })

  it('基准里 preview 的 variables 键顺序 = 提交载荷的键顺序（create body 的来源可复核）', () => {
    const preview = JSON.parse(baselinePreviewRequest?.body as string) as {
      variables: Record<string, unknown>
      startUserSelectAssignees: Record<string, unknown[]>
    }
    expect(Object.keys(preview.variables)).toEqual([
      'staffId',
      'staffName',
      'reason',
      'startTime',
      'endTime',
      'destination',
      'remark',
    ])
    expect(Object.keys(BASELINE_PAYLOAD))
      .toEqual(Object.keys(preview.variables))
    // 浏览器自己也是按节点 **id** 发的（三个 name 一模一样，只能按 id）
    expect(Object.keys(preview.startUserSelectAssignees)).toEqual(REAL_TASK_IDS)
    expect(REAL_TASK_IDS).toHaveLength(3)
    // copyUserIds 只是 preview 组件的参数，**不是表单字段**
    expect(preview).toHaveProperty('copyUserIds')
    expect(Object.keys(preview.variables)).not.toContain('copyUserIds')
  })
})

// ---------------------------------------------------------------------------
// 二、申请人选择器（本流程特有的一整条链）
// ---------------------------------------------------------------------------

describe('用车申请 —— 申请人：按组织分页查（页面的真实数据源）', () => {
  it('applicantScope 走 getRoleOrganizationTree，并摊平顶层的 children（页面 getVehicleUsageOrganizationRoots）', async () => {
    const { calls, capability } = captureSdk()
    const scope = await capability.applicantScope()

    expect(pathOf(calls[0])).toBe('/admin-api/org/organization/getRoleOrganizationTree')
    // 顶层是 34，它 10 个孩子被摊平 —— 实测就是基准里那 10 个
    expect(scope.organizationIds).toEqual(['35', '36', '37', '71', '467', '3997', '4026', '4094', '4099', '4111'])
    expect(JSON.stringify(scope.organizationIds)).toBe(
      JSON.stringify(JSON.parse(baselinePickerBody).organizationIds),
    )
  })

  it('顶层没有 children 时取顶层自己（页面 flatMap 的那一支）', async () => {
    const { capability } = captureSdk(() => [{ id: '9', name: '只有一个节点' }])
    const scope = await capability.applicantScope()
    expect(scope.organizationIds).toEqual(['9'])
  })

  it('组织树是空的时候抛错（页面抛「暂无可选组织」）', async () => {
    const { capability } = captureSdk(() => [])
    await expect(capability.applicantScope()).rejects.toThrow(/暂无可选组织|组织树是空的/)
  })

  it('根组织上限**就是 50**（写死断言，不许跟着常量一起漂）', () => {
    expect(ORG_ROOT_MAX).toBe(50)
    expect(APPLICANT_PAGE_SIZE_MAX).toBe(100)
    expect(APPLICANT_PAGE_SIZE_DEFAULT).toBe(20)
  })

  it('根组织超过 50 个时抛错，且**不发** picker 请求', async () => {
    const many = Array.from({ length: ORG_ROOT_MAX + 1 }, (_, i) => ({ id: `n${i}` }))
    const { calls, capability } = captureSdk(() => many)
    await expect(capability.applicantScope()).rejects.toThrow(new RegExp(`超过 ${ORG_ROOT_MAX}`))

    const picker = captureSdk(() => many)
    await expect(picker.capability.applicantPicker()).rejects.toThrow(/可选根组织/)
    expect(picker.calls.some((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)).toBe(false)
  })

  it('★ 显式传进来 51 个 organizationIds 也会被拦（这条走的是 picker 自己的校验）', async () => {
    const { calls, capability } = captureSdk()
    const tooMany = Array.from({ length: ORG_ROOT_MAX + 1 }, (_, i) => `org-${i}`)
    await expect(capability.applicantPicker({ organizationIds: tooMany }))
      .rejects.toThrow(new RegExp(`最多 ${ORG_ROOT_MAX} 个`))
    expect(calls).toHaveLength(0)

    // 边界值 50 个本身合法
    const ok = captureSdk()
    await ok.capability.applicantPicker({ organizationIds: tooMany.slice(0, ORG_ROOT_MAX) })
    expect(JSON.parse(rawBodyOf(ok.calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)))
      .organizationIds).toHaveLength(ORG_ROOT_MAX)
  })

  it('不给 organizationIds 时先自动拉一次组织范围，再发 picker', async () => {
    const { calls, capability } = captureSdk()
    await capability.applicantPicker({ keyword: '' })

    expect(calls.map(pathOf)).toEqual([
      '/admin-api/org/organization/getRoleOrganizationTree',
      `/admin-api${APPLICANT_PICKER_URL}`,
    ])
  })

  it('picker 的 body 与基准**逐字节**相同（含键顺序与字符串 id）', async () => {
    const { calls, capability } = captureSdk()
    await capability.applicantPicker({ organizationIds: ['35', '36', '37', '71', '467', '3997', '4026', '4094', '4099', '4111'] })

    const pickerCall = calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)
    // ⚠️ 基准里存的是页面**第一次**那条的 body（selectedStaffIds 是 [1163] —— 回显当前登录员工）。
    // SDK 的默认值是 []（页面最后一次 loadInitial 那条），所以逐字节对照要显式给 selectedStaffIds。
    expect(rawBodyOf(pickerCall)).toBe(
      baselinePickerBody.replace('"selectedStaffIds":[1163]', '"selectedStaffIds":[]'),
    )
    const withEcho = captureSdk()
    await withEcho.capability.applicantPicker({
      organizationIds: ['35', '36', '37', '71', '467', '3997', '4026', '4094', '4099', '4111'],
      selectedStaffIds: [1163],
    })
    expect(rawBodyOf(withEcho.calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)))
      .toBe(baselinePickerBody)
    expect(Object.keys(JSON.parse(rawBodyOf(pickerCall)))).toEqual([
      'organizationIds',
      'includeDescendants',
      'keyword',
      'pageNo',
      'pageSize',
      'selectedStaffIds',
    ])
    // organizationIds 是**字符串**数组（组织树里 item.id 就是字符串，页面原样发）
    expect(JSON.parse(rawBodyOf(pickerCall)).organizationIds[0]).toBe('35')
    // 页面的默认值：keyword=''、pageNo=1、pageSize=20、selectedStaffIds=[]
    const parsed = JSON.parse(rawBodyOf(pickerCall))
    expect(parsed.keyword).toBe('')
    expect(parsed.pageNo).toBe(1)
    expect(parsed.pageSize).toBe(APPLICANT_PAGE_SIZE_DEFAULT)
    expect(parsed.selectedStaffIds).toEqual([])
    expect(parsed.includeDescendants).toBe(true)
  })

  it('picker 请求头与基准同一个集合，且**不发 module-type**', async () => {
    const { calls, capability } = captureSdk()
    await capability.applicantPicker()

    const pickerCall = calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)
    const actual = pickerCall?.headers as unknown as Record<string, string>
    const expected = baselinePickerRequest?.headers as Record<string, string>
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')
    expect(actual).not.toHaveProperty('module-type')
  })

  it('selectedStaffIds 原样发（页面回显已选员工用的就是它）', async () => {
    const { calls, capability } = captureSdk()
    await capability.applicantPicker({ selectedStaffIds: [1163] })
    const pickerCall = calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)
    expect(JSON.parse(rawBodyOf(pickerCall)).selectedStaffIds).toEqual([1163])
  })

  it('pageSize 超过 100 在**本地**就被拦（后端 @Max(100)，别发注定 400 的请求）', async () => {
    const { calls, capability } = captureSdk()
    for (const bad of [APPLICANT_PAGE_SIZE_MAX + 1, 101, -1, 0, 1.5]) {
      await expect(capability.applicantPicker({ pageSize: bad })).rejects.toThrow(/pageSize/)
    }
    expect(calls.some((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)).toBe(false)
    // 边界值 100 本身合法
    const ok = captureSdk()
    await ok.capability.applicantPicker({ pageSize: APPLICANT_PAGE_SIZE_MAX })
    expect(JSON.parse(rawBodyOf(ok.calls.find((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`))).pageSize).toBe(100)
  })

  it('空 organizationIds 被拦（后端报「根组织不能为空」）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.applicantPicker({ organizationIds: [] })).rejects.toThrow(/不能为空数组/)
    expect(calls.some((c) => pathOf(c) === `/admin-api${APPLICANT_PICKER_URL}`)).toBe(false)
  })

  it('selectedStaffIds 超过 100 被拦（后端 @Size(max=100)）', async () => {
    const { capability } = captureSdk()
    await expect(
      capability.applicantPicker({
        organizationIds: ['35'],
        selectedStaffIds: Array.from({ length: 101 }, (_, i) => i),
      }),
    ).rejects.toThrow(/selectedStaffIds 最多 100/)
  })

  it('在职状态判据与页面的 ACTIVE_STAFF_STATUS_LIST = [1,4,5] 一致', () => {
    for (const status of [1, 4, 5]) expect(isActiveStaffStatus(status)).toBe(true)
    for (const status of [2, 3, 6, 0, null, undefined, '在职']) expect(isActiveStaffStatus(status)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 三、长选项保护（审批人候选）
// ---------------------------------------------------------------------------

describe('用车申请 —— 审批人候选：长选项参数保护（设计 D6 / H35）', () => {
  it('无关键字、无部门时拒绝调用，且一个请求都不发', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.approverSearch({})).rejects.toThrow(/长选项参数/)
    expect(calls).toHaveLength(0)
  })

  it('pageSize = -1（全量拉取）被拒绝', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.approverSearch({ keyword: '李', pageSize: -1 })).rejects.toThrow(/全量拉取/)
    expect(calls).toHaveLength(0)
  })

  it('给了关键字时走 simple-page + nickname（页面用的就是这个接口）', async () => {
    const { calls, capability } = captureSdk()
    await capability.approverSearch({ keyword: '姚' })

    const url = String(calls[0]?.url)
    expect(url).toContain('/admin-api/system/user/simple-page')
    expect(url).toContain('nickname=')
    // 不能用 simple-list：那是无关键字全量（实测 4225 条）
    expect(url).not.toContain('simple-list')
    expect(queryMapOf(calls[0]).pageSize).toBe('20')
    expect(queryMapOf(calls[0]).nickname).toBe('姚')
  })

  it('给了部门也可以查；没给关键字时**不发 nickname**', async () => {
    const { calls, capability } = captureSdk()
    await capability.approverSearch({ deptId: 100 })
    expect(queryMapOf(calls[0]).deptId).toBe('100')
    // 空串会被后端当成一个筛选条件
    expect(queryMapOf(calls[0])).not.toHaveProperty('nickname')
  })
})

// ---------------------------------------------------------------------------
// 四、载荷构造：逐字段复刻 buildVehicleUsageSubmitData()
// ---------------------------------------------------------------------------

describe('用车申请 —— 载荷构造：逐字段复刻 buildVehicleUsageSubmitData()', () => {
  it('键顺序与浏览器相同，且**没有 id / attachments**', () => {
    const payload = buildVehicleApplicationPayload(draft)
    expect(Object.keys(payload)).toEqual([
      'staffId',
      'staffName',
      'reason',
      'startTime',
      'endTime',
      'destination',
      'remark',
    ])
    expect(payload).not.toHaveProperty('id')
    expect(payload).not.toHaveProperty('attachments')
    // 值是基准里那一份（除 reason 外逐字节可对）
    expect(JSON.stringify(payload)).toBe(JSON.stringify(BASELINE_PAYLOAD))
  })

  it('★ staffId 归一成**字符串**（浏览器发的是 "1163"，不是 1163）', () => {
    expect(buildVehicleApplicationPayload({ ...draft, staffId: 1163 }).staffId).toBe('1163')
    expect(buildVehicleApplicationPayload({ ...draft, staffId: '1163' }).staffId).toBe('1163')
    expect(JSON.stringify(buildVehicleApplicationPayload(draft))).toContain('"staffId":"1163"')
    // 不是 staffId 的三种垃圾输入都要拦住（Number('') === 0 那种洞不在这里）
    for (const bad of ['', '  ', null, undefined, 'abc', {}]) {
      expect(() => buildVehicleApplicationPayload({ ...draft, staffId: bad as never })).toThrow(/staffId/)
    }
  })

  it('★ 字段名是 staffId/staffName，**不是** applicantId（那次映射的产物）', () => {
    const payload = buildVehicleApplicationPayload(draft)
    expect(payload).not.toHaveProperty('applicantId')
    expect(payload).toHaveProperty('staffId')
    expect(payload).toHaveProperty('staffName')
  })

  it('★ remark 缺省是**空串**（不是 undefined），且在**最后**', () => {
    const payload = buildVehicleApplicationPayload({ ...draft, remark: undefined })
    expect(payload.remark).toBe('')
    expect(Object.keys(payload).at(-1)).toBe('remark')
    expect(JSON.stringify(payload)).toContain('"remark":""')
  })

  it('reason 与 destination 必填、卡 500 / 200 字', () => {
    expect(() => buildVehicleApplicationPayload({ ...draft, reason: '' })).toThrow(/用车事由/)
    expect(() => buildVehicleApplicationPayload({ ...draft, reason: '   ' })).toThrow(/用车事由/)
    expect(() => buildVehicleApplicationPayload({ ...draft, destination: '' })).toThrow(/用车目的地/)
    expect(() =>
      buildVehicleApplicationPayload({ ...draft, reason: 'x'.repeat(REASON_MAX + 1) }),
    ).toThrow(new RegExp(`最多 ${REASON_MAX}`))
    expect(() =>
      buildVehicleApplicationPayload({ ...draft, destination: 'x'.repeat(DESTINATION_MAX + 1) }),
    ).toThrow(new RegExp(`最多 ${DESTINATION_MAX}`))
    expect(() =>
      buildVehicleApplicationPayload({ ...draft, remark: 'x'.repeat(REMARK_MAX + 1) }),
    ).toThrow(new RegExp(`最多 ${REMARK_MAX}`))
    // 边界值本身不拦（500 / 200 / 500）
    expect(() =>
      buildVehicleApplicationPayload({
        ...draft,
        reason: 'x'.repeat(REASON_MAX),
        destination: 'y'.repeat(DESTINATION_MAX),
        remark: 'z'.repeat(REMARK_MAX),
      }),
    ).not.toThrow()
  })

  it('staffName 必填且非空', () => {
    for (const bad of ['', '   ', null, undefined, 123]) {
      expect(() => buildVehicleApplicationPayload({ ...draft, staffName: bad as never })).toThrow(/staffName/)
    }
  })
})

// ---------------------------------------------------------------------------
// 五、时间段：一个控件产两个字段 + 严格先后
// ---------------------------------------------------------------------------

describe('用车申请 —— 时间段：a-range-picker 拆成 startTime / endTime', () => {
  it('只认 `YYYY-MM-DD HH:mm:ss`（页面 value-format 与后端 @DateTimeFormat 都是它）', () => {
    for (const bad of ['2026-09-22', '2026/09/22 09:00:00', '2026-09-22T09:00:00', '2026-09-22 09:00', '', null, 123]) {
      expect(() => assertTimeOrder(bad as never, draft.endTime)).toThrow(/startTime/)
    }
    expect(() => assertTimeOrder(draft.startTime, '2026-09-22 15:00')).toThrow(/endTime/)
  })

  it('不存在的日期要拦（2026-02-31 过得了正则）', () => {
    expect(() => assertTimeOrder('2026-02-31 09:00:00', '2026-03-01 09:00:00')).toThrow(/不是一个真实存在的日期/)
  })

  it('时分秒越界要拦（25 时 / 61 分 / 61 秒）', () => {
    for (const bad of ['2026-09-22 25:00:00', '2026-09-22 09:61:00', '2026-09-22 09:00:61']) {
      expect(() => assertTimeOrder(bad, '2026-12-31 23:59:59')).toThrow(/时间部分不合法/)
    }
  })

  it('★ 结束必须**严格**晚于开始 —— 相等也不合法（页面 isSame 那一支）', () => {
    expect(() => assertTimeOrder('2026-09-22 09:00:00', '2026-09-22 09:00:00')).toThrow(/必须大于开始时间/)
    expect(() => assertTimeOrder('2026-09-22 09:00:00', '2026-09-22 08:59:59')).toThrow(/必须大于开始时间/)
    expect(() => assertTimeOrder('2026-09-22 09:00:00', '2026-09-22 09:00:01')).not.toThrow()
    // 跨天也按字典序走（定宽格式下字典序 = 时间序）
    expect(() => assertTimeOrder('2026-09-22 23:00:00', '2026-09-23 01:00:00')).not.toThrow()
  })

  it('本地校验失败时**一个请求都不发**（写操作会惊动真人）', async () => {
    const { calls, capability } = captureSdk()
    await expect(
      capability.submit({ ...draft, startTime: '2026-09-22 15:00:00', endTime: '2026-09-22 09:00:00' }, {}),
    ).rejects.toThrow(/必须大于开始时间/)
    await expect(capability.prepare({ ...draft, reason: '' })).rejects.toThrow(/用车事由/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 六、数据完整性前置（页面 canRefreshVehicleUsageApproval）
// ---------------------------------------------------------------------------

describe('用车申请 —— 数据完整性前置：两道闸，都在发请求之前', () => {
  it('闸 ①（页面的闸 canRefresh…）：选不到人就什么都不问', () => {
    expect(() => assertApplicantResolvable(draft)).not.toThrow()
    for (const field of ['staffId', 'staffName'] as const) {
      expect(() => assertApplicantResolvable({ ...draft, [field]: '' })).toThrow(/申请人没选出来/)
    }
    // 页面 canRefresh… 只看「选不选得到人」，另外四个字段不归它管
    expect(() => assertApplicantResolvable({ ...draft, reason: '' } as never)).not.toThrow()
  })

  it('闸 ②（后端的实际要求）：五个字段缺一不可，且文案点名缺了哪个', () => {
    expect(() => assertDataComplete(draft)).not.toThrow()
    for (const field of ['staffId', 'reason', 'startTime', 'endTime', 'destination'] as const) {
      expect(() => assertDataComplete({ ...draft, [field]: '' })).toThrow(new RegExp(field))
    }
    // 备注**不在**这个集合里（它是可选的）
    expect(() => assertDataComplete({ ...draft, remark: '' } as never)).not.toThrow()
  })

  it('★ 两道闸的差别是**实测出来的**：页面只过闸①，而那样后端会 400', () => {
    const pageWouldSend = { ...draft, reason: '', startTime: '', endTime: '', destination: '' }
    // 页面 canRefresh… 一路放行（这就是基准里那条身体全空的请求发出去的原因）
    expect(() => assertApplicantResolvable(pageWouldSend)).not.toThrow()
    // 但后端的 @Valid 会拒它 —— 实测「全空 → 400 请求参数不正确:结束时间不能为空」
    expect(() => assertDataComplete(pageWouldSend)).toThrow(/都齐了才能问审批人节点/)
    expect(() => assertDataComplete(pageWouldSend)).toThrow(/400/)
  })

  it('★ prepare 在字段不全时**一个请求都不发**（两道闸都在最前面）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.prepare({ ...draft, destination: '' })).rejects.toThrow(/用车目的地/)
    await expect(capability.prepare({ ...draft, staffName: '' })).rejects.toThrow(/申请人没选出来/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 七、★ 审批人不能选发起人本人（本流程最危险的坑）
// ---------------------------------------------------------------------------

describe('用车申请 —— ★ 审批人不能选发起人本人（3 个节点，选中即当场自动通过）', () => {
  const threeTasks = REAL_TASKS as never

  it('findSelfApproverConflicts：按 userId 认，三个节点里中几个报几个', () => {
    const assignees = { Activity_0yx86ms: [OTHER], Activity_0q8l1yc: [SELF], Activity_0viq4cx: [OTHER] }
    expect(findSelfApproverConflicts(threeTasks, assignees, SELF)).toEqual([
      { taskId: 'Activity_0q8l1yc', taskName: '发起人自选' },
    ])
    // 换个「自己」就换成别的节点中招（说明认的是 userId 值，不是节点位置）
    expect(findSelfApproverConflicts(threeTasks, assignees, OTHER)).toHaveLength(2)
    expect(findSelfApproverConflicts(threeTasks, assignees, 999999)).toHaveLength(0)
  })

  it('只中一个节点时抛错，文案说明「那个节点会当场通过」', () => {
    expect(() =>
      assertApproversNotSelf(threeTasks, { Activity_0yx86ms: [SELF] }, SELF),
    ).toThrow(/自动审核通过/)
    expect(() =>
      assertApproversNotSelf(threeTasks, { Activity_0yx86ms: [SELF] }, SELF),
    ).toThrow(/1\/3 个节点中招/)
  })

  it('★ 三个节点全中时，文案必须点明「会永久留下一条撤不掉的单据」', () => {
    const all = {
      Activity_0yx86ms: [SELF],
      Activity_0q8l1yc: [SELF],
      Activity_0viq4cx: [SELF],
    }
    expect(() => assertApproversNotSelf(threeTasks, all, SELF)).toThrow(/全部节点/)
    expect(() => assertApproversNotSelf(threeTasks, all, SELF)).toThrow(/永久留下一条撤不掉的单据/)
    expect(findSelfApproverConflicts(threeTasks, all, SELF)).toHaveLength(3)
  })

  it('全选了**别人**时不抛（正常路径）', () => {
    expect(() =>
      assertApproversNotSelf(
        threeTasks,
        { Activity_0yx86ms: [OTHER], Activity_0q8l1yc: [OTHER], Activity_0viq4cx: [OTHER] },
        SELF,
      ),
    ).not.toThrow()
  })

  it('selfUserId 必须是数字（传 staffId 会静默判错，所以非数字直接抛）', () => {
    expect(() => findSelfApproverConflicts(threeTasks, {}, '姚淼鑫')).toThrow(/selfUserId/)
  })

  it('⚠️ submit **不会**自动拦这条（页面不拦，SDK 忠实复刻）—— 只有显式调用才拦', async () => {
    const { calls, capability } = captureSdk()
    // 选了本人也照样把请求发出去（这就是为什么要靠调用方/冒烟自己调 assertApproversNotSelf）
    await capability.submit(draft, {
      Activity_0yx86ms: [SELF],
      Activity_0q8l1yc: [SELF],
      Activity_0viq4cx: [SELF],
    })
    expect(calls.some((c) => pathOf(c).endsWith('/vehicle-usage-application/create'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 八、自选审批人预检：三份实现逐例对照
// ---------------------------------------------------------------------------

describe('用车申请 —— 自选审批人预检（与另外两条流程表单线同一套规则）', () => {
  const REAL_TASK = {
    id: 'Activity_1',
    name: '发起人自选',
    minSelectCount: 1,
    maxSelectCount: 2,
    approvalDescription: '所选人员按选择顺序依次审批',
  }

  it('三份实现（本文件 / general-approval / leave-application）结论逐例一致', async () => {
    // ⚠️ 这条是**防止三份实现漂移**的那一条：本文件不能 import
    // general-approval 的**值**（Node 类型剥离跑不起来，见能力文件头的导入注释），
    // 所以只能复刻；复刻就会漂。这里把三边都拉进来跑同一张表。
    const { assertAssigneesForTasks: generalApproval } = await import('../src/capabilities/general-approval.js')
    const { assertAssigneesForTasks: leaveApplication } = await import('../src/capabilities/leave-application.js')

    const cases: Array<[string, Record<string, number[]>, boolean]> = [
      ['没选人', {}, true],
      ['选了 1 个（合法）', { Activity_1: [1] }, false],
      ['选了 2 个（合法，等于 max）', { Activity_1: [1, 2] }, false],
      ['超了 max（3 > 2）', { Activity_1: [1, 2, 3] }, true],
      ['有重复（1,1）', { Activity_1: [1, 1] }, true],
      ['有 NaN 那一类（Number 后仍不是有限数）', { Activity_1: [Number.NaN] }, true],
      ['有 null', { Activity_1: [null as never] }, true],
    ]
    const run = (fn: (tasks: never[], assignees: never) => void, assignees: Record<string, number[]>) => {
      try {
        fn([REAL_TASK] as never[], assignees as never)
        return false
      } catch {
        return true
      }
    }
    for (const [label, assignees, shouldThrow] of cases) {
      expect(run(assertAssigneesForTasks, assignees), `本文件 / ${label}`).toBe(shouldThrow)
      expect(run(generalApproval, assignees), `general-approval / ${label}`).toBe(shouldThrow)
      expect(run(leaveApplication, assignees), `leave-application / ${label}`).toBe(shouldThrow)
    }
  })

  it('min 不满足时拒', () => {
    expect(() => assertAssigneesForTasks([{ ...REAL_TASK, minSelectCount: 3 } as never], { Activity_1: [1] }))
      .toThrow(/至少要选 3 个人/)
  })

  it('★ 本流程每个节点 max = 1：一个节点塞两个人**本地就拦**（通用审批那边 max 是 null，不拦）', () => {
    const single = REAL_TASKS as never
    expect(() =>
      assertAssigneesForTasks(single, { Activity_0yx86ms: [1, 2] }),
    ).toThrow(/最多选 1 个人/)
    // 通用审批那个节点 max=null，同样两个人在那边是放行的 —— 这条对照钉住两边没抄错
    expect(() =>
      assertAssigneesForTasks(
        [{ id: 'Activity_1o1sabd', name: '发起人自选2', minSelectCount: 1, maxSelectCount: null } as never],
        { Activity_1o1sabd: [1, 2] },
      ),
    ).not.toThrow()
  })

  it('空串与空数组是个洞（Number("") === 0 / Number([]) === 0）；真正的写请求由 normalizeAssignees 守住', async () => {
    // ⚠️ **拦不住的**：本文件刻意与另外两份行为等价，那条对照测试才是一句真话。
    // 三个节点都要填满，否则先红在「没有选人」那一条上，测不到这个洞。
    const sneakyAssignees = (sneaky: unknown) => ({
      Activity_0yx86ms: [sneaky],
      Activity_0q8l1yc: [OTHER],
      Activity_0viq4cx: [OTHER],
    })
    for (const sneaky of ['', '  ', []]) {
      expect(() =>
        assertAssigneesForTasks(REAL_TASKS as never, sneakyAssignees(sneaky) as never),
      ).not.toThrow()

      const { calls, capability } = captureSdk()
      await expect(capability.submit(draft, sneakyAssignees(sneaky) as never))
        .rejects.toThrow(/不是有效的用户 id/)
      expect(calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 九、写链路
// ---------------------------------------------------------------------------

describe('用车申请 —— 写链路：prepare → submit', () => {
  it('submit 的 body = 载荷 + startUserSelectAssignees，且它**排在最后**', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, {
      Activity_0yx86ms: [197832],
      Activity_0q8l1yc: [197833],
      Activity_0viq4cx: [197834],
    })

    const createCall = calls.find((c) => pathOf(c).endsWith('/hr/vehicle-usage-application/create'))
    expect(createCall).toBeDefined()
    const body = JSON.parse(rawBodyOf(createCall))
    expect(Object.keys(body)).toEqual([
      'staffId',
      'staffName',
      'reason',
      'startTime',
      'endTime',
      'destination',
      'remark',
      'startUserSelectAssignees',
    ])
    expect(JSON.stringify(body).startsWith(
      `${JSON.stringify(buildVehicleApplicationPayload(draft)).slice(0, -1)},"startUserSelectAssignees":`,
    )).toBe(true)
    expect(body.startUserSelectAssignees).toEqual({
      Activity_0yx86ms: [197832],
      Activity_0q8l1yc: [197833],
      Activity_0viq4cx: [197834],
    })
  })

  it('submit 会**先问一次**审批人节点（页面 handleSubmit 的 bpmFinalizeStartUserSelectTasks）', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, OTHER_ASSIGNEES)

    expect(calls.map(pathOf)).toEqual([
      '/admin-api/hr/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks',
      '/admin-api/hr/vehicle-usage-application/create',
    ])
  })

  it('漏了节点 ⇒ 在**发出 create 之前**就红（后端会报 ASSIGNEES_NOT_CONFIG）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.submit(draft, { Activity_0yx86ms: [1] })).rejects.toThrow(/没有选人/)
    expect(calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)
  })

  it('startUserSelectAssignees 形状不对时也拒（不在**发出 create 之前**才红）', async () => {
    const { calls, capability } = captureSdk()
    // 本流程有 3 个节点，只给一个键 ⇒ 先红在「另外两个没选人」
    await expect(capability.submit(draft, { Activity_0yx86ms: [OTHER] })).rejects.toThrow(/没有选人/)
    await expect(capability.submit(draft, null as never)).rejects.toThrow(/没有选人/)
    // 值不是数组时同样过不去（本流程 tasks 非空，所以先落在「没有选人」那一支）
    await expect(
      capability.submit(draft, {
        Activity_0yx86ms: 'x' as never,
        Activity_0q8l1yc: [OTHER],
        Activity_0viq4cx: [OTHER],
      }),
    ).rejects.toThrow()
    expect(calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)
  })

  it('submit 返回的是**业务单据 id**（不是流程实例 id）', async () => {
    const { capability: cap2 } = makeSdk((c) =>
      pathOf(c).endsWith('/getTemporaryRequiredStartUserSelectTasks')
        ? REAL_TASKS
        : 4242,
    )
    await expect(
      cap2.submit(draft, OTHER_ASSIGNEES),
    ).resolves.toBe(4242)
  })

  it('能力实例上没有 submitIdempotent（包装归组装点）', async () => {
    const { capability } = captureSdk()
    expect((capability as Record<string, unknown>).submitIdempotent).toBeUndefined()
    expect(typeof capability.submit).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 十、详情 / 找流程实例 / 取消
// ---------------------------------------------------------------------------

describe('用车申请 —— 详情、找流程实例与取消', () => {
  it('detail 打的接口与参数对（GET /hr/vehicle-usage-application/get?id=）', async () => {
    const { calls, capability } = captureSdk(() => ({ id: 7, processInstanceId: 'pi-1' }))
    const record = await capability.detail(7)
    expect(pathOf(calls[0])).toBe('/admin-api/hr/vehicle-usage-application/get')
    expect(queryMapOf(calls[0]).id).toBe('7')
    expect(record?.processInstanceId).toBe('pi-1')
  })

  it('查不到时返回 null（后端 BeanUtils.toBean(null, …) 实测就是回 null，不报错）', async () => {
    const { capability } = captureSdk(() => null)
    await expect(capability.detail(0)).resolves.toBeNull()
  })

  it('★ detail 原样透传（含「刚 create 完 status=0、statusName 恒为 null」这两个实测事实）', async () => {
    // 2026-09-21 真实提交后回读到的就是这一份形状：
    // status=0（createApplication 没有 setStatus，DO 用数据库默认值），statusName=null
    // （DO 里没有这一列，BeanUtils.toBean 拷不过来）。
    // 这条测试**不是**在给这两个坑背书，是把它们钉住 —— 免得有人以为 detail().status 能判活。
    const actual = {
      id: 39,
      staffId: 1163,
      staffName: '姚淼鑫',
      reason: 'SDK-TEST-用车申请冒烟',
      startTime: '2026-09-21 09:00:00',
      endTime: '2026-09-21 18:00:00',
      destination: 'SDK-TEST-冒烟目的地',
      remark: null,
      status: 0,
      statusName: null,
      processInstanceId: '69e4f213-b50d-11f1-addd-00505683dd67',
      creator: 18243,
      createTime: '2026-09-21 00:07:46',
    }
    const { capability } = captureSdk(() => actual)
    const record = await capability.detail(39)
    expect(record).toEqual(actual)
    expect(record?.status).toBe(0)
    expect(record?.statusName).toBeNull()
    // ⚠️ 判「流程还活着吗」要看 myInstances 的 status（1 = 审批中），不是这里
    expect(record?.processInstanceId).toBe('69e4f213-b50d-11f1-addd-00505683dd67')
  })

  it('★ resolveProcessInstanceId 优先用 detail 的 processInstanceId —— **不翻「我的流程」**', async () => {
    const { calls, capability } = captureSdk((config) => {
      if (pathOf(config).endsWith('/hr/vehicle-usage-application/get')) {
        return { id: 7, processInstanceId: 'pi-direct' }
      }
      return { list: [], total: 0 }
    })
    await expect(capability.resolveProcessInstanceId(7)).resolves.toBe('pi-direct')
    expect(calls).toHaveLength(1)
    expect(calls.some((c) => pathOf(c).endsWith('/bpm/process-instance/my-page'))).toBe(false)
  })

  it('没给 processInstanceId 时退回「我的流程」按 businessKey 找（页面上真实发生的那条）', async () => {
    const { calls, capability } = captureSdk((config) => {
      if (pathOf(config).endsWith('/hr/vehicle-usage-application/get')) {
        return { id: 7, processInstanceId: null }
      }
      return {
        list: [{ id: 'pi-from-list', businessKey: '7', processDefinitionKey: VEHICLE_APPLICATION_PROCESS_KEY }],
        total: 1,
      }
    })
    await expect(capability.resolveProcessInstanceId(7)).resolves.toBe('pi-from-list')
    expect(calls.map(pathOf)).toEqual([
      '/admin-api/hr/vehicle-usage-application/get',
      '/admin-api/bpm/process-instance/my-page',
    ])
  })

  it('★ 跨流程的 businessKey 不会被误认（同号不同流程）', async () => {
    const { capability } = captureSdk((config) => {
      if (pathOf(config).endsWith('/hr/vehicle-usage-application/get')) return { id: 7 }
      return {
        list: [
          // businessKey 是各业务表自己的主键，撞号很正常
          { id: 'pi-meeting', businessKey: '7', processDefinitionKey: 'meeting_application' },
          { id: 'pi-vehicle', businessKey: '7', processDefinitionKey: VEHICLE_APPLICATION_PROCESS_KEY },
        ],
        total: 2,
      }
    })
    await expect(capability.resolveProcessInstanceId(7)).resolves.toBe('pi-vehicle')
  })

  it('cancel 走通用的 cancel-by-start-user，body 是 { id, reason }（本流程没有自己的 cancel 端点）', async () => {
    const { calls, capability } = captureSdk(() => null)
    await capability.cancel({ processInstanceId: 'pi-9', reason: 'SDK-TEST 冒烟收尾' })

    expect(pathOf(calls[0])).toBe('/admin-api/bpm/process-instance/cancel-by-start-user')
    expect(String(calls[0]?.method).toLowerCase()).toBe('delete')
    expect(JSON.parse(rawBodyOf(calls[0]))).toEqual({ id: 'pi-9', reason: 'SDK-TEST 冒烟收尾' })
    // 页面上不存在 /cancel/{id} 这个端点（实测 404），SDK 不能凭空造一个
    expect(calls.some((c) => String(c.url).includes('/vehicle-usage-application/cancel'))).toBe(false)
  })

  it('cancel 的 reason 必填（后端 @NotEmpty），空串时**一个请求都不发**', async () => {
    const { calls, capability } = captureSdk(() => null)
    for (const bad of ['', '   ', undefined, null]) {
      await expect(capability.cancel({ processInstanceId: 'pi-9', reason: bad as never }))
        .rejects.toThrow(/取消原因/)
    }
    expect(calls).toHaveLength(0)
  })

  it('两个 id 都不给时拒绝', async () => {
    const { calls, capability } = captureSdk(() => null)
    await expect(capability.cancel({ reason: 'x' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)
  })

  it('myInstances 的请求参数与页面一致（三个空筛选 + 分页）', async () => {
    const { calls, capability } = captureSdk(() => ({ list: [], total: 0 }))
    await capability.myInstances({ pageNo: 2, pageSize: 50 })

    expect(pathOf(calls[0])).toBe('/admin-api/bpm/process-instance/my-page')
    expect(queryMapOf(calls[0])).toMatchObject({
      order: '',
      orderField: '',
      name: '',
      title: '',
      category: '',
      pageNo: '2',
      pageSize: '50',
    })
    // status / processType 不给时**不发**（页面筛选项为空时也不发）
    expect(queryMapOf(calls[0])).not.toHaveProperty('status')
    expect(queryMapOf(calls[0])).not.toHaveProperty('processType')
  })
})

// ---------------------------------------------------------------------------
// 十一、能力定义
// ---------------------------------------------------------------------------

describe('用车申请 —— 能力定义', () => {
  it('九条能力，id 唯一，pagePath 三类', () => {
    const ids = vehicleApplicationCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'vehicle-application-definition',
      'vehicle-application-applicant-scope',
      'vehicle-application-applicant-picker',
      'vehicle-application-approver-search',
      'vehicle-application-prepare',
      'vehicle-application-submit',
      'vehicle-application-detail',
      'vehicle-application-my-instances',
      'vehicle-application-cancel',
    ])
    for (const cap of vehicleApplicationCapabilities) {
      if (cap.id === 'vehicle-application-definition') {
        expect(cap.pagePath).toBe(VEHICLE_APPLICATION_PAGE_PATH)
      } else if (cap.id.endsWith('my-instances') || cap.id.endsWith('cancel')) {
        expect(cap.pagePath).toBe(VEHICLE_APPLICATION_MY_LIST_PATH)
      } else {
        expect(cap.pagePath).toBe(VEHICLE_APPLICATION_FORM_PATH)
      }
    }
  })

  it('只有 submit 与 cancel 是写能力', () => {
    expect(vehicleApplicationCapabilities.filter((c) => c.write).map((c) => c.id)).toEqual([
      'vehicle-application-submit',
      'vehicle-application-cancel',
    ])
  })

  it('submit 的参数里有 staffId（**不是** applicantId）与 startUserSelectAssignees', () => {
    const submit = vehicleApplicationCapabilities.find((c) => c.id === 'vehicle-application-submit')
    const names = (submit?.params ?? []).map((p) => p.name)
    expect(names).toContain('staffId')
    expect(names).not.toContain('applicantId')
    expect(names).toContain('startUserSelectAssignees')
    expect(names).toContain('startTime')
    expect(names).toContain('endTime')
    // 本表单**没有附件控件**
    expect(names).not.toContain('attachments')
    expect(names).not.toContain('copyUserIds')
  })

  it('★ 每一处 lookup 都指向**真的能给出候选**的那条能力', () => {
    const findParam = (capabilityId: string, paramName: string) =>
      vehicleApplicationCapabilities
        .find((c) => c.id === capabilityId)
        ?.params.find((p) => p.name === paramName)

    // 审批人（userId）的候选入口是「按关键字搜用户」
    expect(findParam('vehicle-application-submit', 'startUserSelectAssignees')?.lookup?.capabilityId)
      .toBe('vehicle-application-approver-search')
    expect(findParam('vehicle-application-submit', 'startUserSelectAssignees')?.lookup?.keywordParam)
      .toBe('keyword')

    // ★ 申请人（staffId）的候选入口是**选择器本身**，不是 applicant-scope。
    // scope 只回答「有哪些根组织」、连一个人员候选都给不出来，指它会走死胡同。
    for (const capabilityId of ['vehicle-application-prepare', 'vehicle-application-submit']) {
      expect(findParam(capabilityId, 'staffId')?.lookup?.capabilityId, capabilityId)
        .toBe('vehicle-application-applicant-picker')
      expect(findParam(capabilityId, 'staffId')?.lookup?.keywordParam, capabilityId).toBe('keyword')
    }

    // 每一处 lookup 的目标能力都**真的有**那个参数（否则引导走不通）
    for (const cap of vehicleApplicationCapabilities) {
      for (const param of cap.params) {
        if (!param.lookup) continue
        const target = vehicleApplicationCapabilities.find((c) => c.id === param.lookup?.capabilityId)
        expect(target, `${cap.id}.${param.name} → ${param.lookup.capabilityId}`).toBeDefined()
        expect(
          target?.params.some((p) => p.name === param.lookup?.keywordParam),
          `${cap.id}.${param.name} → ${param.lookup.capabilityId}.${param.lookup.keywordParam}`,
        ).toBe(true)
      }
    }
  })

  it('★ organizationIds **刻意没有 lookup**（组织树不接受任何参数，没有"按关键字查组织"这回事）', () => {
    // 曾经登记过一条指向 applicant-scope 的 lookup，被 catalog.validate().lookups 抓出来 ——
    // 而它确实不该存在：候选来源是 getRoleOrganizationTree，那条接口一次返回整棵树、
    // 没有关键字也没有分页，所以「先调 scope 拿 id 再填进来」是两步取候选，
    // 不是 lookup 表达的那种「带关键字查候选」。不为过测试而指一个不合适的入口。
    const picker = vehicleApplicationCapabilities.find((c) => c.id === 'vehicle-application-applicant-picker')
    const orgs = picker?.params.find((p) => p.name === 'organizationIds')
    expect(orgs?.lookup).toBeUndefined()
    // 但引导仍在描述里（读的人照描述走一样到得了）
    expect(orgs?.description).toContain('vehicle-application-applicant-scope')

    // applicant-scope 本身也确实一个参数都没有 —— 这正是它当不了候选入口的原因
    const scope = vehicleApplicationCapabilities.find((c) => c.id === 'vehicle-application-applicant-scope')
    expect(scope?.params).toEqual([])
  })

  it('流程类型是 2（审批）—— 与请假（1 审核）不同，用于「我的流程」里认单', () => {
    expect(VEHICLE_APPLICATION_PROCESS_TYPE).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 十二、防重那一层只声明形状（包装在组装点）
// ---------------------------------------------------------------------------

describe('用车申请 —— 组装点要补的那一层', () => {
  it('能力模块只声明形状：submitIdempotent 是类型，不是实现', () => {
    expect(typeof createVehicleApplicationCapability).toBe('function')
  })
})
