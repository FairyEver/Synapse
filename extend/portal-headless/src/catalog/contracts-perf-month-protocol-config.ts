import type { AiContract, AiField } from './ai-contract.js'
import {
  MONTH_PROTOCOL_CONFIG_LINES,
  perfAgreementCapabilities,
} from '../capabilities/perf-agreement.js'

/**
 * 「个人月度」页弹窗配置读接口的 AI 契约（`perf-month-protocol-config-get`）。
 *
 * 控件源码：`app/portal/views/dashboard/hr/month-agreement/main/components/info.vue:12-16`
 * （`useAsyncState(() => http.get('/sys/dict/data/getMonthProtocolConfig'))`），
 * 由 `main/list.vue:153-161` 的 `actionViewInfo()` 开一个 `createModal` 挂上去。
 *
 * 本文件是自包含的，由主线统一接线进 `src/catalog/ai-contracts.ts` ——
 * 与 `contracts-study-course.ts` 等同一形态。
 *
 * ⚠️ `docs/pages/个人月度.md` 曾经写着「这个弹窗是纯展示、没有接口」——那是**错的**，
 * 本轮按源码改掉。它不发请求只是因为**没点开**：组件没被创建，`useAsyncState` 就不会跑。
 */

const definitions = new Map(perfAgreementCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const contracts: Record<string, AiContract> = {}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`月度协议配置契约没有对应的能力定义：${id}`)
  contracts[id] = value
}

add('perf-month-protocol-config-get', {
  purpose: '读取「个人月度」页「时间节点及扣分标准」弹窗里的四行配置文本（签订 / 自评 / 评价 / 申诉的时间与扣分口径）。',
  whenToUse:
    '用户问「月度协议什么时候签/什么时候自评/评价和申诉截止到几号、迟了扣多少分」时使用；' +
    '这是**个人月度**那一页读的那一份。年度协议页读的是另一个端点（perf-year-protocol-config-get），两份配置不能互相代替。',
  boundaries: [
    '页面路径是 /dashboard/month-agreement/main/list，但这条请求**只在用户点开弹窗、组件被创建时才发**（useAsyncState 写在组件 setup 里），不是页面挂载请求 —— 所以没有基准不代表页面不发它。',
    '权限码与菜单页同为 /dashboard/month-agreement/main；页面上下文推导 module-type=13（绩效管理）。',
    '**零参数**：页面调用里连 params 都没有，URL 上只有 `_t`。所以本能力不收任何筛选、也没有分页。',
    '返回的是**已经渲染好的整句文案**：天数与扣分值由后端从「协议时间节点配置」字典读出后套进模板。SDK 不解析这些句子、不把其中的日期抠成字段 —— 页面也只是把每一项原样换行显示。',
    '这四行是**读**接口，改天数要去绩效的「时间节点」配置页（那是另一条链路），本能力不承担配置职责。',
    '文案的语言与措辞由后端模板决定（SysDictDataServiceImpl 里的字符串常量），不是本 SDK 生成的，也不要当成可翻译的 UI 文案去改写。',
  ],
  effect: 'read',
  prerequisites: [
    '使用当前用户会话与租户创建 SDK；该用户对 /dashboard/month-agreement/main 有权限。',
    '调用前不需要任何 ID：这条配置是租户级的，与具体协议无关。',
  ],
  inputs: {},
  output: {
    shape: 'string[]（固定 4 项，顺序由后端 result.add 的次序决定）',
    fields: [
      field('$', 'string[]', '四行配置文案，按签订 → 自评 → 评价 → 申诉的固定顺序；页面把它们逐项渲染成独立段落。'),
      field('$[]', 'string', '一行完整的中文句子（形如「月度协议签订时间为次月X日之前完成，延迟N天扣M分，最多扣K分」）。内容是**原值**，SDK 不做任何替换或格式化。', {
        constraints: [
          `第 1 项：${MONTH_PROTOCOL_CONFIG_LINES[0].meaning}。`,
          `第 2 项：${MONTH_PROTOCOL_CONFIG_LINES[1].meaning}。`,
          `第 3 项：${MONTH_PROTOCOL_CONFIG_LINES[2].meaning}。`,
          `第 4 项：${MONTH_PROTOCOL_CONFIG_LINES[3].meaning}。`,
          '序号按 0 起算的下标（页面渲染顺序即此顺序）；不要按句子里出现的日期重排。',
        ],
      }),
    ],
    empty:
      '[] 不是正常结果：这个实现无条件 add 四行。拿到空数组应视为响应形状异常或后端配置缺失，' +
      '不要向用户报告「没有时间节点」。请求失败会抛错，不会降级成空数组。',
  },
  consume: [
    '按返回顺序把四项分别交付给用户：第 1 项签订、第 2 项自评窗口、第 3 项评价与延迟扣分、第 4 项申诉截止 —— 顺序是契约的一部分，不要按句子里出现的日期重新排列。',
    '把整句原样呈现，不要二次改写或摘要成「截止 X 日」这样的简化结论：句子里的「延迟 N 天扣 M 分，最多扣 K 分」是同一句约定的一部分，拆开会丢语义。',
    '句子里的「最后一天」是后端对字典值 99 的特殊渲染（表示当月最后一天），不是缺失值；不要把它读成「未配置」。',
    '要判断某份协议**是否已经逾期**，请用协议列表行的状态字段（perf-month-agreement-list 的 status，字典 month_task_review_status），不要拿这四行文案自己算日期。',
  ],
  steps: [],
  completion: '交付这四行配置文本即可结束：它是纯读取，不触发任何后续动作，也不改变任何配置。',
  failures: [
    '会话或权限错误原样抛出（后端未登录类失败会塌缩成同一个 401）；按提示恢复登录/权限后再读，不要回退到年度那一份配置。',
    '返回项数不是 4、或元素不是字符串时说明契约变了，停止按本说明解释并重新核对；不要按 0/1/2/3 硬取某一项。',
    '只读查询可安全重试；重试不会改变配置。',
  ],
  idempotency: null,
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/hr/month-agreement/main/list.vue:153-161、components/info.vue:1-16',
      kind: 'reference',
      note: '核对弹窗的打开方式（createModal 挂组件，故 useAsyncState 只在点开时执行）、调用无 params、以及组件把返回数组逐项渲染成 <p> 的行为。未覆盖：该弹窗没有任何浏览器基准（基准只抓页面挂载请求）。',
    },
    {
      source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c SysDictDataController:139、SysDictDataServiceImpl:283-338（MONTH_SIGN_INFO / SELF_SCORE_INFO / REVIEW_SCORE_INFO / APPEAL_INFO 四个模板常量）',
      kind: 'reference',
      note: '核对端点路径、CommonResult<List<String>> 返回类型、四次 result.add 的固定顺序与四段模板文案里的占位含义。固定检出静态证据，不代表该提交已部署到测试环境，也没有真实响应样本。',
    },
    {
      source: 'src/capabilities/perf-agreement.ts',
      kind: 'implementation',
      note: '锁定能力 id、方法名、零参数的请求形状与不做任何解析的返回。',
    },
  ],
  gaps: [
    '没有浏览器基准、也没有在真实测试环境执行过；四项的固定顺序来自 Java 实现的 result.add 次序，未用真实响应复核。',
    '四行文案里由字典注入的天数与扣分值（协议时间节点配置字典）的取值域未查，本能力也不解析它们。',
  ],
})

export const PERF_MONTH_PROTOCOL_CONFIG_CONTRACTS: Record<string, AiContract> = contracts
