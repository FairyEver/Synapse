# AI 消费 `-llm` 协议：黑盒评测报告

- 日期：2026-09-20
- 被测对象：`portal-headless` 的能力目录（设计 D14 的自描述协议），提交 `4bcc32f`
- 评测装置：`tools/eval/`（可复跑）
- 结论一句话：**`describe()` 能让人（和模型）想清楚「该做什么」，但没有任何一处告诉它「怎么把这一次调用发出去」。协议停在决策层，没接到执行层。**

---

## 0. 先说结论（按严重程度）

| # | 缺口 | 严重度 | 证据 |
|---|---|---|---|
| G1 | `describe()` 不给调用绑定：拿不到方法名 / HTTP 细节 / 通用 invoke | **阻断** | 452 KB 目录输出里 `roomUsage`、`meetingApplication` 零出现 |
| G2 | 长选项参数的解析路径是断的：`consumption` 说「用 lookup 指定的能力」，但 `lookup` 字段不存在 | **阻断** | 7 个能力 24 个参数，`lookup` 出现 0 次；且 `next`/`related` 也不指向会议室候选来源 |
| G3 | `next` 给出岔路：订会议室链路被 `meeting-application-definition` 插一跳 | 高 | 引导路径 3 跳 vs 语义最短 2 跳 |
| G4 | `recommend` 不分读写意图，「查会议室有哪些」与「订会议室」给出完全相同的前三名 | 高 | usage 110.2 > list 89.8（T1）；两者 top-3 顺序一致 |
| G5 | 没有明确的「没有这个能力」信号，失败只能从空数组推断 | 高 | `recommend` 无 `ok`、无 `warnings`；零命中时 `next` 连 `args` 都缺 |
| G6 | `describe` 失败时的 `suggestions` 按注册顺序取前 5，与查询无关 | 中 | 查 `reimburse-submit` 建议 `meeting-room-list` |
| G7 | 能力上挂着页面级注释，把有解链路说成无解 | 中 | `meeting-room-usage.consume.notes` 说「表单提交不在已登记能力里」 |
| G8 | 返回契约缺失，但 `keyFields` 里其实藏着形状，两者不互相印证 | 中 | 5/7 能力 `returns.confidence: 'unknown'` |
| G9 | `listDomains()` 17.8 KB，比它要引出的 `describe()`（2.4~3.4 KB）重得多 | 低 | 见 §5 载荷表 |
| G10 | `catalog.index` 的查找表全是空对象，与同一对象里的数组自相矛盾 | 低 | `pageById`/`capabilityById`/`domains` 均为 `{}` |

---

## 1. 黑盒纪律与本次的诚实披露

**允许读的**：`docs/usage.md`、`docs/roadmap.json`。
**允许做的**：运行 SDK，读 `sdk.catalog.*` 的真实返回。
**没读**：`src/` 下任何实现文件；`README.md` 未读；其它测试文件未读。

我实际看过、但**不属于上面两份文档**的东西，逐条列出来：

1. `package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`、`git log`、目录清单 —— 构建配置，不含协议语义。
2. `dist/index.js` 的**导出名清单**（`Object.keys(mod)`）。这是公开 API 面，与 `docs/usage.md` 第 3 行的口径一致（「API 清单来自 `dist/index.js` 的实际导出」），不含实现。
3. `sdk.catalog.index` —— **未文档化的原始索引**。我在探索阶段 dump 过它，用途只有一个：确认它里面有哪些内部字段，好写 `consumer-view` 的脱敏名单（`definitions`/`primary`/`conflict`/`pageById`…）。**它不是任何一题的作答依据**；`tools/eval/consumer-view.mjs` 明确不碰它，测试里也有一条断言专门钉这一点。
4. `git ls-files dist/` 与 `.gitignore` —— 用来确认 `dist/` 没入库，因此给 `consumer-view` 加了 `src/index.ts` 兜底。

没有为了完成任何一个任务去读 `src/`。卡住的地方都记在下面（§3），卡住时我选择的是「标注缺口 + 按最合理推测作答」，不是「去翻源码」。

答不上来时我的处理方式：凡是要真调一次后端才知道的值（会议室 ID），标 `deferred: true` 并写清「我会怎么取」，不假装知道。

---

## 2. 五个任务的完整过程

判分口径：落点是否正确、有没有编造能力、参数是否齐全、**每个参数的出处**是否交代、参数取值是否合契约、该问用户时有没有问。

### T1 `direct` — 「查一下会议室有哪些」

**SDK 给了什么**

```
recommend('查一下会议室有哪些')
  capabilities: meeting-room-usage(110.2) > meeting-room-list(89.8)
              > meeting-application-submit(75.5) > meeting-application-definition(70.2)
              > meeting-application-cancel(51.0)
  next: describe(meeting-room-usage) | describePage(/dashboard/meeting-room/list)
```

**我怎么判断**：首位 `meeting-room-usage` 的 title 是「查询各会议室的**预定占用情况**」——用户问的是「有哪些会议室」，不是「哪间被占了」。于是下钻第二位。

```
describe('meeting-room-usage')  → params: [date]；title 确认不是我要的
describe('meeting-room-list')   → params: name/authorizedOrgId/pageNo/pageSize；title「查询会议室列表」✓
describePage('/dashboard/meeting-room/list') → 该页只有 meeting-room-list 一个能力，确认落点唯一
```

**为什么没有读源码**：不需要。两句话的 title 差异足够区分。**但这是我人工读标题纠正的排序**——`recommend` 本身没给对（G4）。

**最后打算怎么调**

| 项 | 值 |
|---|---|
| 能力 | `meeting-room-list` |
| pageNo | `1` ← `describe().params.pageNo` 默认 1 |
| pageSize | `20` ← `describe().params.pageSize` 默认 10，取 20 少翻一页 |

**这里就撞上 G1**：`describe()` 告诉了我参数叫 `pageNo`，但**没告诉我这个能力要用 `sdk.meetingRoom.list({...})` 来调**。`meeting-room-list` 这个 id 在整个目录输出里没有任何一处映射到方法名。我能写出「调哪个能力、传什么」，但写不出「用哪行代码」。

---

### T2 `drilldown` — 「帮我订明天下午2点到3点的会议室，开周会，2个人」

**SDK 给了什么**：`recommend` 给出 usage(122.2) > list(101.8) > submit(81.5) > definition(77.4) > cancel(51.0)，`next` 指向 `describe(meeting-room-usage)`。

**追链路（这是最值得看的一段）**

```
describe('meeting-room-usage')
  params: [date]
  keyFields: meetingRooms[].meetingRoomId
    「挑出目标时段没有 timeSlot 的会议室后，进入会议室审批流程」
  next[0]: describe('meeting-application-definition')   ← 岔路

describe('meeting-application-definition')
  params: [key]（固定 meeting_application）
  next[2]: describe('meeting-application-prepare')      ← 绕回来了

describe('meeting-application-prepare')
  params: meetingName*, meetingRoomId*, startTime*, endTime*, attendeeCount*, attendees
  keyFields: tasks；next[0]: describe('meeting-application-submit')

describe('meeting-application-submit')
  write: true；params 同 prepare + startUserSelectAssignees
  keyFields: id
```

**判断**：链路是**通的**，但 `usage → definition → prepare → submit` 里 `definition` 那一跳对订会议室没有贡献——它的唯一参数 `key`（固定 `meeting_application`）在 `submit` 的参数表里不存在。语义上最短应该是 `usage → prepare → submit`。

我实测了引导路径的长度：**沿 `next` 到 `submit` 需 3 跳，语义最短 2 跳，多花 1 跳**。D15 给的任务预算是 4~6 轮，这一跳吃掉预算的 1/3。这就是 **G3**。

**参数从哪来（逐项）**

| 参数 | 值 | 出处 |
|---|---|---|
| meetingName | `周会` | 用户原话「开周会」 |
| meetingRoomId | **运行时才知道** | `roomUsage('2026-09-21')` 返回的 `meetingRooms[].meetingRoomId`，挑 14:00~15:00 无 `timeSlot` 的那间 |
| startTime | `2026-09-21 14:00:00` | 用户「明天下午2点」+ 基准日 2026-09-20 |
| endTime | `2026-09-21 15:00:00` | 用户「到3点」 |
| attendeeCount | `2` | 用户「2个人」 |

时间格式 `YYYY-MM-DD HH:mm:ss`、分钟只能 00/30、秒只能 00、结束晚于开始 —— 这些**全部**来自 `describe().params[].description` 与 `consumption`，写得清楚，可以直接翻成校验。这是协议做得好的地方。

**这里撞上 G2**：`meetingRoomId` 是**唯一一个用户给不出、必须从数据里取的必填参数**。`describe()` 对它的说法是：

```
kind: 'search'
consumption: '**搜索型长选项**：必须先向用户要关键字，用 lookup 指定的能力查候选，禁止无条件下全量拉取（D6）'
warnings: ['参数 meetingRoomId 是长选项但没有登记 lookup，取候选的入口需要人工确认（H35）']
```

`consumption` 让我去找 `lookup` 字段，`lookup` **不存在**（7 个能力的 24 个参数里出现 0 次）。`warnings` 诚实地承认了这一点，但只说了「需要人工确认」，没说该去哪。而且 `prepare`/`submit` 的 `next` 与 `related` **都不指向** `meeting-room-list` 或 `meeting-room-usage`：

```
prepare.related: {samePage:[submit, cancel], sameDomain:[submit, cancel]}
prepare.next 里有没有 meeting-room-list / meeting-room-usage？ false
submit.next  里有没有？                                        false
```

也就是说：**订会议室这条链上，「哪间会议室」这个必填参数，在协议里没有任何一条边指向它的候选来源。** 我能补上这一跳，是因为我在 T1 里已经知道 `meeting-room-list` 存在——不是因为这根链子告诉我。

**最后打算怎么调**：`meetingApplication.prepare(draft)`（只读，拿 `tasks`）→ `tasks` 为空则 `meetingApplication.submit(draft, {})` → 得到单据 id。这两步的分工在 `describe(prepare).next` 和 `notes`（「prepare 是只读的」由 `write:false/true` 区分）里是能读出来的。

---

### T3 `missing` — 「订个会议室」

**SDK 给了什么**：`recommend` 同样给出 5 个候选（usage 116.2 居首）。

**判断**：用户只给了意图。我把 `describe('meeting-application-submit').params` 里 `required: true` 的 5 个直接翻译成「要问用户什么」：

```
meetingName*  meetingRoomId*  startTime*  endTime*  attendeeCount*
```

**这是协议最强的一处**：`required` 标记可以**无损地**变成一份澄清清单，不需要任何猜测或额外知识。D15 说的「宁可多问一次，也不要替用户猜参数」，在协议层是有抓手的。

唯一的软处：协议不区分「必须问」和「可以合理默认」。`attendeeCount` 和 `meetingName` 对一次真实的订会来说，助手常常可以推断或默认；`startTime`/`endTime`/`meetingRoomId` 不行。这一层语义协议没有表达（见 §4 建议 8）。

**最后打算怎么做**：`outcome: 'clarify'`，问 `startTime`、`endTime`、`meetingRoomId`、`meetingName`、`attendeeCount`，不发起任何写调用。

---

### T4 `slang` — 「帮我调薪」

**SDK 给了什么**

```
recommend('帮我调薪')
  interpretations: [ alias:jargon-salary-findqi(46), literal(5) ]
  domains: salary(53.4)
  pages:   工资找齐(73) > 薪资账套(10) > 薪资结构(10) ...
  capabilities: []            ← 空
  next: describePage('/dashboard/salary/adjust/list')

search('调薪')
  terms 展开: 调薪 / 工资找齐 / 工资 / 薪酬 / 薪资
  hits[0]: page「工资找齐」score=179
           matches: [{field:pageTitle, term:'工资找齐', via:'alias', from:'调薪', score:111}]
```

**判断**：黑话命中得很漂亮。这句完全不在菜单上的话，被别名表映射到了「工资找齐」，而且 `matches[].via/from/score` 把「为什么命中」讲得清清楚楚——这是整个协议里解释性最好的部分。

**难点在命中之后**：

```
describePage('/dashboard/salary/adjust/list')
  ok: true, page.title: 工资找齐, capabilities: [], pending: true
  next: listPages('salary')
```

`pending: true` 是「这个页面还没登记能力」的信号，但**它不是一个给模型看的措辞**。「capabilities 空 + pending 真」需要模型自己解读成「做不了」。而且 `next` 还在建议继续往下逛（`listPages`），一个不谨慎的模型会顺着逛下去，而不是回头告诉用户「这个我做不了」。

**最后打算怎么做**：`outcome: 'unsupported'`，`pageRef: '工资找齐'`——告诉用户「这个功能在 Portal 里存在（就是「工资找齐」那个页面），但当前 SDK 没有把它登记成可调用的能力」。这是诚实的落点：既没编能力，也没假装整件事不存在。

---

### T5 `unsupported` — 「报销差旅费」

**SDK 给了什么**

```
recommend('报销差旅费')
  interpretations: [ literal(5) ]        ← 别名、同义词都没命中
  domains: []  pages: []  capabilities: []
  next: [ {tool:'search',  why:'…把用户话术里的名词直接传进 search（H22）'},      ← 注意：没有 args
          {tool:'listDomains', why:'…全目录 7 个能力、1021 个页面…'} ]

search('报销差旅费') → total: 0, hits: [], truncated: false
search('报销')       → total: 0
search('差旅')       → total: 0
```

**判断**：零命中。`search` 给了干净的否定（`total: 0`），但 `recommend` **没有任何否定信号**——它返回空数组，没有 `ok: false`，也没有 `warnings`（`'warnings' in recommend(...)` === `false`）。

更要紧的是回落路径：零命中时 `next` 建议「把用户话术里的名词直接传进 search」，**但那条 `search` 的 `args` 是缺失的**（键根本不存在）。这是一条「告诉你去调 search 但没告诉 search 什么」的边。模型得自己想到把原话塞进去。

**最后打算怎么做**：`outcome: 'unsupported'`，不给页面（目录里确实没有），明确告诉用户这个能力不存在。

**一个真实的风险**：T5 与 T4 在数据上长得很像（capabilities 都空），差别只在 T4 多一个 `pages` 命中。**决定「不支持」还是「继续下钻」的，全靠模型自己看数组空不空。** 协议没有把这件事变成一个显式答案。

---

## 3. 每次「卡住 / 得猜 / 差点去读源码」的时刻

按严重程度排序。

**① 构造调用时 —— 阻断（G1）**
T1、T2、T3 全部卡在同一处：`describe()` 之后我知道「调哪个能力、传哪些参数」，但**没有任何字段告诉我这个能力在 SDK 里叫什么**。我差点去读 `src/index.ts` 看 `meetingApplication` 上有哪些方法——最后没读，改成在报告里把它标成缺口。**这是本次评测最重要的一条产出。**

**② 解析 `meetingRoomId` 时 —— 阻断（G2）**
`consumption` 指向一个不存在的 `lookup` 字段。我确实短暂地去 `describe()` 的返回里翻找过好几遍，怀疑是自己漏看了；最后靠「7 个能力全量扫一遍 `lookup` 出现 0 次」才确认是协议缺字段，不是我看漏。**差一点就去读 `src/catalog/` 确认字段名了。**

**③ 追链路时（G3）**
`meeting-room-usage.next[0]` 指向 `meeting-application-definition`。我一开始以为订会议室的链路真的要先取流程定义，直到发现 `definition` 的 `key` 参数在 `submit` 的参数表里不存在，才判定这是岔路。**这需要跨两次 `describe()` 的返回做一次人工比对，协议没有把边的性质标出来。**

**④ 区分 T1 与 T2 落点时（G4）**
「查一下会议室有哪些」（纯读）和「帮我订个会议室」（读+写）拿到**完全相同的前三名排序**。我只能靠逐条读 title 来区分。一个只取 `capabilities[0]` 的消费者在这两题上会给出同一个答案，而其中至少一题是错的。

**⑤ 判断 T5「是真的没有」时（G5）**
`recommend` 返回全空，没有 `ok`、没有 `warnings`、没有「最近似但仍不够」的提示。我需要额外再调三次 `search`（`报销差旅费`/`报销`/`差旅`）才敢确认这不是分词问题而是目录里真的没有。**协议没说「没有」，我自己证了一遍「没有」。**

**⑥ 读 `describe` 失败建议时（G6）**
`describe('reimburse-submit')` 的 `suggestions` 是 `meeting-room-list`、`meeting-application-definition`…（注册顺序前 5 个）。如果我信了这份建议，会得到一个荒谬的答案。**这个字段看起来像「相关推荐」，实际是「前 5 个」——比没有这个字段更危险。**

**⑦ 读 `meeting-room-usage` 的 `consume.notes` 时（G7）**
注释说「表单提交（创建单据）不在已登记能力里；提交类链路见 `docs/pages/会议室预定.md`」。而 `meeting-application-submit` **是**已登记能力。这条注释是页面级的（说的是 `/dashboard/flow/form/edit` 那一页），但它挂在订会议室链路的**入口能力**上。我停下来重新确认了一遍 submit 确实存在，才没有按注释里的暗示放弃写链路。**差点把有解的链路判成无解。**

**⑧ 想用 `catalog.index` 做查找时（G10）**
`catalog.index.pageById['5d1edd']` 返回 `undefined`，`capabilityById` 是 `{}`，而同一对象里的 `pages`/`capabilities` 数组是满的。我花了一点时间确认这不是我取错了键。未文档化接口，但自相矛盾。

**⑨ 顺带记一条观察（不是缺口，但值得 owner 复核）**
`工资找齐` 页面的 `moduleTypeLabel` 是「**绩效管理**」，而它的路由是 `app/portal/views/dashboard/hr/salary/adjust/list.vue`。我无法在不读源码的情况下判断这是推导规则如此还是推导错了，只作为观察记录。

---

## 4. 协议哪里说清楚了、哪里没说

### 说清楚了（这些别动）

1. **`describe().params[].required`** —— 可以直接翻成澄清清单。T3 一次就成了。
2. **`params[].description` 与 `consumption`** —— 时间格式、分钟只能 00/30、秒只能 00、结束必须晚于开始、pageSize 不能传 -1、pageSize ≤50，全部写死在契约里，不用猜。`assertTimeSlot` 的规则和它是对得上的。
3. **`search().matches[]`（`field` / `via` / `from` / `score`）** —— 解释性极好。「调薪」为什么命中「工资找齐」，返回里写清了是 `via: 'alias'`、`from: '调薪'`。
4. **`describe().warnings[]`** —— 诚实。D34 的 module-type 不可算、H36 的页面不在菜单树、H35 的 lookup 缺失，都主动说了。**G2 我能这么快定位，靠的就是这条 warning。**
5. **`next[]` 带 `why`** —— 引导链路真的能闭合（3 跳到 submit）。这是协议的核心资产。
6. **分层下钻** —— `listDomains → listPages → describePage → describe` 四层各司其职，没有哪一层是多做的。
7. **`write: true/false`** —— prepare（只读）/ submit（真写）的分工一眼可辨。
8. **`describe` 的失败回执** —— `{ok:false, reason}` + `reason` 里把已注册能力全列出来，是有用的（`consumer-view` 就是靠它拿到能力白名单的）。

### 没说清楚

1. **怎么把这次调用发出去**（G1）。协议自称是「自描述」，但自描述止于逻辑契约，缺执行绑定。
2. **长选项参数从哪儿取候选**（G2）。`consumption` 的措辞暗示有一个 `lookup` 机制，字段却是空的。
3. **边的性质**：`next` 里「下一步」和「岔路」长得一模一样（G3）。
4. **能力之间的读写意图**：`recommend` 没有把 read/write 纳入排序信号（G4）。`capabilities[]` 里带了 `write` 字段，但排序没用它。
5. **「没有」这件事**（G5）。`search` 有 `total: 0`，`recommend` 什么都没有。
6. **`suggestions` 的语义**（G6）。是「相关」还是「前 N 个」？从返回值看不出，实际是后者。
7. **注释的作用域**（G7）。`consume.notes` 混装了页面级、能力级、域级三种信息，没有标记。
8. **返回形状**（G8）。`returns.shape` 说「未登记」，`keyFields` 却写着 `meetingRooms[].meetingRoomId`——形状实际是知道的，只是没放在 `returns` 里；而且没有标明 `meetingRooms` 是顶层数组还是嵌套字段。

---

## 5. 对 `-llm` 协议的具体改进建议

按性价比排序，每条都尽量给到字段级。

**建议 1｜给 `describe()` 补执行绑定（解 G1，最高优先）**

> 已修（commit 略）：两个都给——`describe().invoke = { capabilityId, sdkPath }`（方案 A 的 sdkPath）+ 通用入口 `sdk.capabilities.invoke(id, args)`（方案 B），同一张绑定表（`src/capabilities/invoke.ts`），多用户门面 `scoped.capabilities.invoke` 等价；未登记/未接线一律抛 `CapabilityInvokeError`。

二选一：

```jsonc
// 方案 A：在 describe() 里给出具体绑定
"invoke": {
  "kind": "sdk-method",
  "path": "meetingApplication.roomUsage",   // 或
  "registry": "capabilities", "id": "meeting-room-usage"
}

// 方案 B：不暴露方法名，给通用入口（更干净，推荐）
sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
// describe() 只需声明 "invokable": true
```

方案 B 更好：它让「能力 id」真正成为唯一的调用句柄，消费者不需要知道 SDK 的内部分组（`meetingApplication` / `meetingRoom` 这种模块划分对调用方是噪音）。无论选哪个，**必须让 `capabilityId` 直接可用**。

**建议 2｜把 `lookup` 填上（解 G2）**

> 已修（commit 略）：prepare/submit 的 `meetingRoomId` → `meeting-room-list`（关键字 `name`）、submit 的 `startUserSelectAssignees` → `meeting-user-search`；`CAPABILITY_LINKS` 加了 `list → prepare`、`usage → prepare` 两条边，`related` 新增 `upstream`/`downstream`；`consumption` 里那句空头承诺已改成只在真有 lookup 时出现，并新增 `validate().lookups` 自检。

```jsonc
{
  "name": "meetingRoomId",
  "kind": "search",
  "required": true,
  "lookup": {
    "capabilityId": "meeting-room-list",
    "valueField": "id",
    "labelField": "name",
    "filterArg": "name"          // 关键字往哪个参数里传
  }
}
```

同时把这条边加进 `related`，让 `meeting-room-list` 出现在 `prepare`/`submit` 的邻接表里。**`consumption` 里那句「用 lookup 指定的能力查候选」在 `lookup` 填上之前应该删掉**——现在它是一句空头承诺，比不说更糟。

**建议 3｜给 `next` 的边标性质（解 G3）**

> 已修（commit 略）：`NextStep.role` 为必填，`usage` 的首选边改成 `meeting-application-prepare`（`role: next`），`usage → definition` 标成 `detour` 并排到后面；引导路径实测 2 跳。边性按语义最短链逐条定，不按代码分支批量默认：必填长选项的候选来源 = `next`、选填参数的候选来源 = `detour`、`submit → cancel`（事后动作）= `detour`、同页兄弟与页面层 = `detour`。

```jsonc
{ "tool": "describe", "args": {...}, "why": "…", "role": "next" }     // 前进
{ "tool": "describe", "args": {...}, "why": "…", "role": "detour" }   // 岔路/可选
```

至少要让 `meeting-room-usage` 的首选边指向 `meeting-application-prepare`。D15 的 4~6 轮预算很紧，省下的那一跳是实打实的。

**建议 4｜`recommend` 纳入意图（解 G4）**

> 已修（commit 略）：两种都做了——`intent`（从话术抽读写动词，附信号词）+ `capabilityGroups: { read, write }`；加权只作用于写能力（write ×1.15 / read ×0.75），"先选会议室"仍排在 submit 前面。

- 最低成本：把 `capabilities` 按 `[read 候选] / [write 候选]` 分组下发，让消费者自己选。
- 更好：从话术里抽动词（「查 / 看 / 有哪些」vs「订 / 提交 / 申请」），对 `write: true` 的能力做加权或减权。T1 的首位就应该是 `meeting-room-list`。

**建议 5｜`recommend` 给显式否定与可用的回落（解 G5）**

> 已修（commit 略）：`ok` / `reason`（区分"认得页面但页面没能力"与"一个字都没对上"）；回落边的 `args` 补上（recommend → `{ keyword: 原话 }`，search → `{ text: 原话 }`）。未做：`nearest`（可选字段，未加）。

```jsonc
{ "ok": false,
  "reason": "目录里没有匹配这句话的能力（1021 个页面 / 7 个能力）",
  "nearest": [{ "capabilityId": "...", "title": "...", "score": 12 }] }   // 可选
```

并且修掉回落的 `args` 缺失：`{ "tool": "search", "args": { "keyword": "<原话>" }, "why": "…" }`。

**建议 6｜`suggestions` 用相关性排序（解 G6）**

> 已修（commit 略）：复用 `search` 的打分器（`buildQueryTerms` + `scoreMatch`），每条带 `score`；0 分不列——列不出来就是真没有（全量清单仍在 `reason` 里）。

复用 `search` 的打分器。如果做不到，就把字段改名叫 `sample` 或 `someCapabilities`——**别让一个名字像「相关推荐」的字段实际返回「注册顺序前 5」**。

**建议 7｜给 `consume.notes` 标作用域（解 G7）**

> 已修（commit 略）：`notes` 每条带作用域前缀 `[能力]` / `[协议]` / `[页面 <menuPath>]`（保持 `string[]`，不破坏解析方）；那句"表单提交不在已登记能力里"已按页面重写，不再跟着能力进链路入口。

```jsonc
"notes": [
  { "scope": "capability", "text": "…" },
  { "scope": "page",       "text": "这是流程表单页，不在菜单树里（H36）" },
  { "scope": "domain",     "text": "…" }
]
```

至少把那句「表单提交不在已登记能力里」限制在它真正描述的那一页（`/dashboard/flow/form/edit`），不要跟着 `meeting-room-usage` 一起进到订会议室链路的入口。

**建议 8｜把 `keyFields` 升级成真正的返回契约（解 G8）**

```jsonc
"returns": {
  "shape": "{ meetingRooms: Array<{ meetingRoomId, timeSlots: Array<{ startTime, endTime }> }> }",
  "confidence": "from-key-fields",
  "fields": [
    { "path": "meetingRooms[].meetingRoomId",
      "means": "…",
      "role": "join-key",
      "resolveVia": "meeting-room-list" }
  ]
}
```

`role` 是关键：区分「这是下一步的入参（join-key）」和「这是给用户看的（display）」。现在这两类混在同一个数组里。

**建议 9｜`listDomains()` 减重（解 G9）**

> 已修（commit 略）：`listDomains({ detail: false })` 不逐个域给 `next`/`kinds`；本机实测 JSON 19,110 → 7,801 字符（约 -59%）。未做：`next` 只留 1 条那个更激进的版本。

46 个域各带 2 条 `next`，17.8 KB。建议 `next` 只留 1 条，或支持 `listDomains({ detail: false })` 只回 `domain/label/pageCount/capabilityCount`。这个调用通常是第一步，不该是整条链上最重的一次。

**建议 10｜补一个「我在链上的什么位置」的提示**

`describe()` 可以给 `chainRole: 'entry' | 'step' | 'terminal'`。T2 里 `meeting-room-usage` 是 entry、`prepare` 是 step、`submit` 是 terminal——有了这个字段，模型不必靠 `next` 是否指向自己来判断走到头没有。

**建议 11｜`warnings` 键统一**

> 已修（commit 略）：`search` / `listPages` / `describePage` / `recommend` 都补上了 `warnings: string[]`（永远存在，可为空数组）。

`describe` 和 `listDomains` 都有 `warnings: []`，`recommend` 完全没有这个键。同一个协议族里字段有无不一致，解析方就得到处写 `?? []`。

---

## 6. 载荷实测（供 D14「不要一次塞给模型」参考）

| 调用 | JSON 字节 |
|---|---|
| `search('工资')` | 4,918 |
| `listDomains()` | **17,776** |
| `recommend('帮我订…')` | 2,997 |
| `describe(meeting-room-list)` | 2,591 |
| `describe(meeting-room-usage)` | 2,426 |
| `describe(meeting-application-prepare)` | 3,043 |
| `describe(meeting-application-submit)` | 3,443 |
| 4 个 `describe` 合计 | 11,503 |
| `catalog.index`（原始，未文档化） | **452,605** |

结论：`describe()` 的粒度是对的（单次 2.4~3.4 KB，四个能力合起来 11.5 KB，完全放得进上下文）。真正需要收着用的是 `listDomains()`——**17.8 KB 比它要引出的每一次 `describe()` 都重**，这与分层的初衷是相反的。原始 `index` 的 452 KB 确认了「不能整个塞进去」这个前提是对的。

---

## 7. 评测装置怎么用、将来怎么复跑

```
tools/eval/
  tasks.mjs            5 个任务的定义（用户原话 + 期望落点 + 可接受的其他落点 + 判分规则）——纯数据
  answers.mjs          本轮的作答（decision + trace）——接模型时替换的就是这个文件
  consumer-view.mjs    调用方视角：输入话术，输出「你会看到的信息」，内部调 catalog 且强制脱敏
  scoring.mjs          判分（纯函数，不碰 SDK、不起网络）
  run.mjs              执行器
  *.d.mts              给 tsc 用的类型声明（tools/ 不在 tsconfig include 里，靠 .d.mts 让 test 导入保持类型干净）
```

跑法：

```bash
pnpm build                                   # 一次即可；dist/ 没入库，新克隆的仓库必须跑
node tools/eval/run.mjs                      # 全跑，打印报告；全过退出码 0
node tools/eval/run.mjs T2 --trace           # 只跑某一题，带过程
node tools/eval/run.mjs --json               # 机器可读
node tools/eval/consumer-view.mjs "帮我调薪"  # 直接看调用方视角
pnpm exec vitest run test/eval-*.test.ts     # 装置自检
```

**接新页面 / 接真实模型时怎么复跑**

- 页面批量生成之后：`tasks.mjs` 里的 `acceptableCapabilityIds` / `requiredChain` 可能需要加新的合理落点；**任务结构本身不用改**。有一条测试会自动检查「任务引用的参数名是否真出自那个能力」，能力被重命名时会直接红。
- 接真实模型：把 `answers.mjs` 换成模型吐出的同构 JSON（`{ decision, trace }`），`tasks` / `scoring` / `consumer-view` 一行都不用动。
- `consumer-view` 的脱敏名单（`INTERNAL_KEYS`）是显式的，新增内部字段时往数组里加一条即可，泄露会被测试挡住。

**装置自检覆盖了什么**（`test/eval-*.test.ts`，41 个用例）

- 任务定义：id 唯一、五类难度各覆盖、`expect` 字段与 `outcome` 自洽、`argRules` 规则名合法、**引用的参数名/能力 id 必须在真实目录里存在**。
- 判分：每题都有正例 + 反例。反例是真实可能出现的坏作答（落点选错、编能力、参数缺出处、分钟填 15、结束早于开始、信息不足却硬提交、零命中却硬塞页面）。另有一条**反空转**用例：能力白名单为空时任何能力都算编造。
- consumer-view：脱敏真的会剥键（嵌套与数组内都测）、每一句话术的视图里都没有内部字段、**`catalog.index` 不在输出键里**、dist 缺失时回落到 src、全都缺失时抛可操作的错误、本轮 5 题全过。

---

## 8. 下一步建议

1. **G1 + G2 必须先修**，否则「AI 用 -llm 协议跑真实任务」这条路线是无法闭合的——不是模型不够聪明，是协议没给出口。这两条修完，T1/T2/T3 就真正可跑了。
2. 修完 G1/G2 后，用一版**真实模型**重跑这套装置（换掉 `answers.mjs`），才能回答「模型会不会用」这个原始问题。本轮回答的是它的前置问题：「协议给的东西够不够用」——**决策层够，执行层不够**。
3. G3~G5 是体验与成本问题（多一跳、排序不对、要自己证否定），建议与 G1/G2 同批修。
4. `工资找齐` 的 `moduleTypeLabel` 建议 owner 复核一次（§3 ⑨）。

---

## 9. 本次没有做的事（明确边界）

- 没有发任何真实网络请求，没有使用凭据，没有碰浏览器。
- 没有运行任何写 git 的命令。
- 没有修改 `src/`、`docs/usage.md`、`docs/roadmap.json`、`package.json`、`README.md`、`generated/**` 或任何其它测试文件。
- 没有跑全量 `pnpm test`（有并发的代理在改 `src/idempotency/**`、`src/capabilities/generated/**`、`tools/generate/batch-capabilities.mjs`）；只跑了 `test/eval-*.test.ts`。
- 只跑了 `tsc --noEmit` 确认本装置的类型干净；当前仓库里有 `src/idempotency/store.ts` 的 3 个类型错误，来自并发代理的在途改动，与本装置无关。
