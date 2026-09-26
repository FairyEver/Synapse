import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { PERSON_SEARCH_MAX_PAGE_SIZE, baseManagementCenterCapabilities } from '../capabilities/base-management-center.js'

/**
 * 组织结构页**表单里那个负责人下拉**的 AI 契约：`GET /sys/user/getUserListPage`。
 *
 * 组织结构本体的 CRUD 契约在 `contracts-business.ts`（上一轮做的）。这一份是
 * **自包含**的本轮增量，由主线接进权威目录。
 *
 * 为什么原来漏了：判据是「页面只要有**任一**能力指向它就算完成」，而这条请求由隐藏表单页
 * `[mode]/[id].vue` 的「负责人」下拉组件发出 —— 组织结构页已有 7 条能力，所以整页被算作已覆盖，
 * 而这条人员候选请求没有落进任何能力。
 */

const definitions = new Map(baseManagementCenterCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const parameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const base = (
  id: string,
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>,
): AiContract => {
  if (!definitions.has(id)) throw new Error(`Base management center contract has no capability definition: ${id}`)
  return {
    ...value,
    whenToUse:
      '用户要在「学习管理 → 基础数据 → 组织结构」的新建/编辑表单里挑一个**负责人**时使用：按姓名关键字查候选，拿到的是工号形式的 username（组织结构记录的 commander 字段要的就是它）。它不是"按姓名查系统用户 id"：要 sys_user.id 请用 base-user-search。',
    boundaries: [
      '长选项参数：**必须先给关键字**（keyword 姓名模糊，或 username 精确用户名，二选一）。无关键字时后端返回的是全租户「在职且组织非空」的用户分页，几千条量级 —— 页面自己就是这么拉的，SDK 不照抄（设计 D6 / H35）。',
      `pageNo ≥ 1、pageSize 在 1~${PERSON_SEARCH_MAX_PAGE_SIZE}（后端 validatePage 的硬上限）；不接受 pageSize = -1 这类"全量"写法。`,
      `端点是 GET /sys/user/getUserListPage（platform 实例、module-type=12 学习管理，页面上下文由 SDK 绑定）；它不是 base-user-search 打的 /admin-api/system/user/simple-page。`,
      '**返回值只包含 username 与 realName 两个字段**：后端 SysUserDTO 里带着 password / password2 / salt，SDK 在能力层把它们连同其它与页面无关的字段一起去掉（与拒绝 /org/organization/getUserByType 同一条理由）。',
      '候选只覆盖「在职（status=1）且 organization_id 非空」的用户；离职、无组织归属的人不会出现在这里，这**不是**"系统里没有这个人"。',
      '本能力只解决候选读取：把某个 username 写进组织结构负责人的动作是 base-management-center-create / update（且 update 刻意不接受 commander）。',
    ],
    prerequisites: [
      '使用当前用户、当前租户的会话 token 创建 SDK，并拥有组织结构页权限。',
      '先向用户问清姓名关键字（或已知的用户名）；不要用"先拉一页看看"的方式获取候选人。',
      '把选中的候选写进 commander 之前，让用户确认是**同一个人**（同名候选可能多条）。',
    ],
    failures: [
      'keyword 与 username 都没给会直接拒绝（Promise.reject），不发请求；pageNo/pageSize 越界同样在本地拒绝。',
      '401/403、租户/数据范围、网络错误与响应形状错误原样抛出；空候选页不能单独证明"系统里没有这个人"，应先确认关键字（后端是 `real_name like`，需要子串匹配上）。',
      '只读查询超时可以重试；重试时保留同一组关键字与分页参数。',
    ],
    evidence: [
      {
        source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/base/management-center/[mode]/[id].vue（37-59 行）',
        kind: 'reference',
        note: '确认两条调用：`fetchStudentPage(keyword, pageNo, pageSize)` 发 {pageNo,pageSize,(name)}、`fetchSelectedStudents(usernames)` 发 {username,pageNo:1,pageSize:1}；并确认下拉的 value=item.username、label=item.realName（`portal-education-dropdown-student` 在有 fetchPage 时的 normalizeItem）。固定检出源码证据，未在真实环境调用。',
      },
      {
        source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa HrSysUserController#getUserListPage、HrSysUserServiceImpl#getUserListPageData / buildUserListQuery / validatePage、SysUserDTO、SysUserEntity',
        kind: 'reference',
        note: '确认参数名（name/username/pageNo/pageSize）、查询条件（organization_id 非空 + status=1 + real_name like + username 相等）、`ConvertUtils.sourceToTarget` 会把 password/password2/salt 一并拷进 DTO、以及 pageSize 上限 500；静态源码证据，未在真实环境调用。',
      },
      {
        source: 'src/capabilities/base-management-center.ts',
        kind: 'implementation',
        note: '锁定参数顺序、关键字必填与分页边界、以及返回值的两个字段投影。',
      },
    ],
    gaps: [
      '没有浏览器基准（`baseline/base-management-center.browser.json` 抓的是结构组织 CRUD，不含这条人员候选请求）。',
      '尚未在真实测试环境调用过这个端点；候选规模、以及后端是否真的把 password/salt 序列化出来（Jackson 配置可能屏蔽）都未实测 —— 投影是按"不冒险"的方向做的，即使后端不返回也不会错。',
      '`real_name like` 是否区分大小写/全半角未核实；关键字命中不了时不要据此推断人不存在。',
    ],
  }
}

const personFields: AiField[] = [
  field('username', 'string', '用户名（工号形式）。**它才是组织结构 commander 字段的取值**，不是 sys_user.id。', { source: '后端 SysUserEntity.username' }),
  field('realName', 'string', '姓名；下拉的显示文本。同名的人可能多条，选择时要让用户确认。', { source: '后端 SysUserEntity.real_name' }),
]

export const BASE_MANAGEMENT_CENTER_AI_CONTRACTS: Record<string, AiContract> = {
  'base-management-center-person-search': base('base-management-center-person-search', {
    purpose: '按姓名关键字（或精确用户名）分页查询组织结构「负责人」下拉的候选员工，返回 username 与 realName。',
    effect: 'read',
    inputs: {
      keyword: parameter(
        '姓名关键字（后端 `real_name like %keyword%`）。与 username 至少给一个；两个都不给会被 SDK 拒绝。',
        '用户明确给出的姓名（或姓名片段）',
        { type: 'string', required: false, requiredWhen: '与 username 至少提供一个；两个都没有时 SDK 直接拒绝', omitted: '不发 name 参数；此时必须给 username', constraints: ['不要用"看一下有哪些人"的空关键字调用'] },
      ),
      username: parameter(
        '用户名，**精确相等**（后端 `username = ?`）。用于回显已知的负责人：给一个 username + pageSize=1 就够了。',
        '已知的 commander 值（来自 base-management-center-list / get），或用户明确给出的工号',
        { type: 'string', required: false, requiredWhen: '与 keyword 至少提供一个', omitted: '不发 username 参数；此时必须给 keyword' },
      ),
      pageNo: parameter('页码，从 1 开始。', '调用方分页状态', {
        type: 'integer',
        required: false,
        omitted: 'SDK 使用 1',
        default: '1',
        constraints: ['必须 ≥1（后端 validatePage 的判据）'],
      }),
      pageSize: parameter('每页条数。', '调用方分页状态', {
        type: 'integer',
        required: false,
        omitted: 'SDK 使用 20',
        default: '20',
        constraints: [`必须是 1~${PERSON_SEARCH_MAX_PAGE_SIZE} 的整数；后端 validatePage 越界会抛错`, '不接受 -1 或其它"全量"写法'],
      }),
    },
    output: {
      shape: '{ list: object[], total: number }',
      fields: [
        field('$', 'object', '候选分页结果。'),
        field('list', 'object[]', '当前页候选，不是全部候选。'),
        field('list[]', 'object', '一名候选员工。'),
        ...personFields.map(item => ({ ...item, path: `list[].${item.path}` })),
        field('total', 'number', '符合关键字的候选总数，不是当前页长度。'),
      ],
      empty: 'list=[] 表示这个关键字没有匹配到在职且组织非空的用户；total=0 才是"没有候选"。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
    },
    consume: [
      '把 list[].realName 展示给用户选择；选中后取**同一行的 username** 作为 commander，不要取 realName、也不要取其它字段。',
      '同名候选可能多条：展示时带上工号（页面就是 `姓名（工号：username）` 的形式），由用户确认后再写。',
      '需要翻页时按 total 判断是否还有下一页；不要靠"这一页满了"推断还有更多。',
    ],
    steps: [
      { role: 'required', when: '用户确认了某个候选并且要新建组织结构', capabilityId: 'base-management-center-create', mapping: { commander: 'result.list[].username' }, instruction: '把选中的那一行的 username 传给 create.commander；create 要求 commander 非空（后端对 null 会 NPE 并让所有人的列表页 500）。' },
      { role: 'optional', when: '只是想核对某个已知负责人的姓名', capabilityId: 'base-management-center-person-search', mapping: { username: 'args.username', pageNo: 'literal:1', pageSize: 'literal:1' }, instruction: '用 username 精确查一条即可，不要用关键字模糊匹配去撞。' },
    ],
    completion: '返回该关键字下的候选分页；候选本身不写入任何记录，写入由 create / update 承担。',
    idempotency: null,
  }),
}
