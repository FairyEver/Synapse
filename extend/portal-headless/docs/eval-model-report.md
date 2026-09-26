# 真实模型跑 `-llm` 协议：评测报告

- 日期：2026-09-20
- 评测装置：`tools/eval/`（`tasks.mjs` / `scoring.mjs` / `consumer-view.mjs` / `answers.mjs` / `run.mjs` **一行未改**）
- 驱动器：`tools/eval/model.mjs`（本轮新增）
- 装置自检：`test/eval-model.test.ts`（本轮新增，31 个用例，确定性桩模型）
- 上一轮（人工作答）的报告：`docs/eval-report.md` —— 本文件不动它
- 结论一句话：**真实模型能把协议用起来（决策层它是通的），但是过不了这套题。
  修复后的协议跑了三轮，稳定 2/5（2/5、2/5、2/5，红绿分布完全一致）；未修的对照 3/5，但那只有 n=1。**
  卡住它的第一堵墙仍然是协议本身（G2 被独立复现）；翻过那堵墙之后，剩下的失败主要落在
  「答案契约的语义歧义」和「模型自己的行为习惯」上，而不是协议缺口。
  另外：本轮的答案契约让 G1 变成了测量盲区——这是装置的问题，不是协议已解决。
- **§11 是后补的稳定性样本（修复后再跑两轮）**，含逐题稳定性表与「n=1 不能下结论」的说明。

---

## 0. 先说结论（按严重程度）

| # | 发现 | 类型 | 证据 |
|---|---|---|---|
| N1 | **G2 被真实模型独立复现**：`meetingRoomId` 取不到候选时，模型停在 `prepare` 前面回头问用户，并点名 D6 / H35 | 协议缺口（已复现） | 修前 T2 作答 `clarify`，notes 原文引 H35 |
| N2 | **G1 在本轮是测量盲区**：答案契约里 `capabilityId` 就是句柄，模型根本不需要「怎么把这次调用发出去」 | 装置缺陷 | 两轮 10 次作答里，`invoke` / 方法路径出现 0 次 |
| N3 | **`chain` 的语义在协议侧是歧义的**：模型读成「我走过/看过什么」，判分读成「我这次要调什么」 | 答案契约 / 协议措辞 | 同一行为修前拿分、修后扣分（T3、T5） |
| N4 | **模型把协议的工具名当成能力 id**：T5 的 `chain` 里写了 `["recommend","search"]` | 协议命名风险 | 修后 T5 `no-fabricated-capability` 红 |
| N5 | **模型会把参数名改写成自然语言**：`meetingRoomId` → `meetingRoomKeyword(会议室名称关键字)` | 协议 + 模型 | 修后 T3 `clarification-covers` 红 |
| N6 | **`ok:false` 减少了歧义，但没减少「自证否定」的成本**：给了显式否定后，T5 仍然连搜 5 次撞上限 | 协议（G5 未收尾） | 两轮 T5 都 `budgetExceeded` |
| N7 | **8 次预算对下钻题偏紧**：T2/T5 四次作答里有三次贴到或撞上上限 | 装置/协议预算 | D15 说 4~6 轮，实测不够 |
| N8 | 修后的 `role` 标注在 `meeting-application-submit` 上像是反的：`prepare` 标 `detour`，`meeting-user-search` / `cancel` 标 `next` | 待 owner 复核 | `describe('meeting-application-submit').next` |
| N9 | **T5 的「零命中连页面都不该给」与协议自身的导航能力冲突**：模型用 `listDomains → listPages` 翻出一个真实相关页面，反而被判红 | 任务口径 vs 协议方向 | 补跑 round3；见 **§11.6** |

---

## 1. 这一轮回答的是哪个问题

上一轮（`docs/eval-report.md`）的作答是**手写的**（`tools/eval/answers.mjs`）。
它回答的是「协议给的东西够不够用」，结论是「决策层够，执行层不够」，
并给出 G1~G11 十一条缺口。那份报告的 §8 第 2 条写得很清楚：

> 用一版**真实模型**重跑这套装置（换掉 `answers.mjs`），才能回答「模型会不会用」这个原始问题。

本文件就是这个问题。两轮的判分口径是**同一份** `scoring.mjs`，差别只在「谁在作答、怎么看协议」：

| | 上一轮 | 本轮 |
|---|---|---|
| 作答者 | 一个有耐心、会跨返回比对的「人」 | 真实模型 `deepseek-flash` |
| 信息获取 | 一次性拿到整份目录转储 | 自己决定调哪个工具、看哪个返回 |
| 预算 | 无 | 每题最多 8 次目录工具调用 |
| 判分 | `scoring.mjs` | **同一份**，一个字没改 |

## 2. 驱动器怎么做的（`tools/eval/model.mjs`）

### 2.1 模型连接

不引任何依赖（这个包本来也没有 `@anthropic-ai/sdk`），`fetch` 手写 Anthropic Messages 协议：

- `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`（本机指向 DeepSeek 的 Anthropic 兼容端点）
- 缺任一变量时抛**可操作**的错误（点明要设哪两个变量、给出示例命令），不静默失败
- `ANTHROPIC_MODEL` 里的 `[1M]` 这类上下文窗口后缀会剥掉再发（它不是模型名的一部分）
- 429 / 5xx / 网络错误退避重试；4xx 直接报错

### 2.2 是 agentic 循环，不是单轮问答

模型看到的工具就是调用方能用的那 6 个目录方法 + 1 个交卷方法：

```
recommend(utterance)    search(keyword)      listDomains()
listPages(domain)       describePage(pageId) describe(capabilityId)
submit_decision({ outcome, capabilityId, chain, args, missing, pageRef, notes })
```

三处刻意设计：

1. **每一次工具返回值都过 `consumer-view.mjs` 的 `redact()`**。
   驱动器不自己写剥离逻辑，直接 `import { redact }` —— 脱敏名单只有一处定义。
   这条有专门的测试钉住，并且配了一条**反空转**断言（不脱敏的原始返回里**确实**有内部字段）。
2. **任务话术是模型能拿到的全部任务信息**。
   `expect` / `acceptableCapabilityIds` / `requiredChain` / `argRules` 一个字都不进 prompt。
   有一条测试遍历全部任务，断言这些字段不出现在系统提示里。
3. **交卷是工具调用，不是解析自然语言**。模型必须调 `submit_decision`，
   产出的结构与 `answers.mjs` 同构，原样交给 `scoring.mjs`。

系统提示只讲两件事：**「你看得到什么」** 和 **「交卷长什么样」**。
不写任何一题的期望落点，也不写「信息不足要问用户」这类本该由协议自身传达的产品策略
—— 那正是本轮要测的东西。

一处需要披露的**环境信息**：系统提示第一行是基准日 `2026-09-20`（取自 `tasks.mjs` 的
`EVAL_TODAY`，不是任何 `expect` 字段）。理由：任何一个真实助手都有钟，不给基准日的话
T2 的「明天下午2点」只能靠模型猜今天是几号 —— 那是与协议无关的干扰项。

### 2.3 预算护栏

每题最多 **8 次目录工具调用**（交卷不算）。用尽后：目录工具从工具表下架 → 提醒一次 →
再空转一轮就强制交卷，并标记 `budgetExceeded`。硬上限 14 轮，防止模型在预算边缘空转。

### 2.4 记账、指纹与可复跑

- 每次请求打印 `in/out` 与累计，整题合计，最后总计（用户自己付费的额度）
- 落盘到 `tools/eval/model-runs/<时间戳>.json`：模型看的（已脱敏）、模型吐的、
  每次请求的用量、**协议指纹**。**不写 token**（落盘时按字段名剔除 + 一条泄露自检，两者都有测试）
- `--score <文件>`：脱离网络复跑判分，不花额度
- `--dist <入口.js>`：把一轮评测钉在某一版构建产物上

---

## 3. 一个必须交代的意外：协议在评测过程中被改掉了

派单时说明「有另外两个代理正在并行改这个仓库」。实际情况：**这两个代理在我准备运行前后
把 `docs/eval-report.md` 的 G1~G5 一次性落地了**，改了 10 个 `src/catalog/**` 文件
（外加 `src/http/**`、`src/index.ts`、`src/server.ts`）。

时间线：

```
20:47:35  第 1 次 pnpm build  失败（src/catalog/list.ts 等 30+ 类型错误）
20:48:36  第 2 次 pnpm build  失败
20:49:42  第 3 次 pnpm build  成功 ← 修复落进 dist/
20:50:44  正式运行 A 结束（用的是修完的 dist/）
20:51:51  正式运行 B 结束（用 git archive HEAD 重建的 17482ce 旧协议，见 §4）
```

于是我把运行拆成两遍，并且**给驱动器加了「协议指纹」**（`describe` 有没有 `invoke` 绑定、
`next` 的边有没有 `role`、参数有没有 `lookup`、`recommend` 有没有显式否定……），
把指纹一起落进产物。两份产物的指纹分别是：

| | `hasInvokeBinding` | `hasLookup` | `hasEdgeRole` | `hasIntentSignal` | `hasExplicitNegative` |
|---|---|---|---|---|---|
| **运行 A**（`dist/`，工作区在途修复） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **运行 B**（HEAD `17482ce`，`git archive` 重建） | ❌ | ❌ | ❌ | ❌ | ❌ |

- **运行 A** = `tools/eval/model-runs/2026-09-20T12-50-44-870Z.json`
- **运行 B** = `tools/eval/model-runs/2026-09-20T12-51-51-250Z.json`

运行 B 的旧协议是把 `git archive HEAD` 解到 `/tmp` 单独 `tsc` 构建的（**没有碰仓库里的
`src/`，也没有跑任何写 git 的命令**），`--dist` 指过去即可。

**没有改任何判分口径**：`tasks.mjs` / `scoring.mjs` / `consumer-view.mjs` / `answers.mjs` /
`run.mjs` 的 `git diff` 为空。

补充一句免得误会：`docs/eval-report.md` 现在**有**改动（G1~G9 各条下面多了「> 已修」的批注），
那是并行代理写的，不是我 —— 我只读了它，一个字没改。这些「已修」批注也可以和本报告
§0/§5 的实测对照着看：**协议侧宣告修好的九条里，真正对模型构成阻断的只有 G2 一条**。

---

## 4. 结果

### 4.1 总账

> ⚠️ **下面这两列每列只有 n=1。** 修复后那一列后来补跑到了 3 个样本（见 **§11**），
> 结论是**稳定 2/5**；修复前那一列**仍然只有 1 个样本**，
> **不要用「3/5 vs 2/5」下任何结论**。

| | 运行 A（协议已修） | 运行 B（协议未修） | 合计 |
|---|---|---|---|
| 判分 | **2/5** | **3/5** | — |
| 过 | T1、T4 | T1、T3、T4 | — |
| 输入 token | 62,180 | 62,056 | 124,236 |
| 输出 token | 9,102 | 4,796 | 13,898 |
| 缓存读 token | 70,528 | 31,360 | 101,888 |
| **token 总计** | **141,810** | **98,212** | **240,022** |
| 请求数 | 18 | 17 | 35 |

模型 `deepseek-flash`，端点 `api.deepseek.com`。另有本次开发期的预热/探针调用
（1 次单题试跑 + 3 次连通性探针）约 5.5K token，未计入上表。

### 4.2 逐题

#### T1 「查一下会议室有哪些」— 两轮都 PASS

| | 工具序列 | 作答 |
|---|---|---|
| A | `recommend` → `search("会议室")` → `describe(meeting-room-list)` | `call → meeting-room-list`，pageNo=1 / pageSize=10 |
| B | `recommend` → `search("会议室")` → `describe(meeting-room-list)` → `describe(meeting-room-usage)` | 同上 |

**与上一轮人工作答一致**：人也是靠读 title 把首位 `meeting-room-usage` 纠正成 `meeting-room-list` 的
（G4）。模型做的完全是同一件事，而且一次就对。**G4 对模型不构成阻断**——它读 title 就够了。

B 多花了一次 `describe(meeting-room-usage)`：它把「下一步可能要看占用」也一并确认了。
这不算走偏，只是多花一跳。

#### T2 「帮我订明天下午2点到3点的会议室，开周会，2个人」— 两轮都 FAIL，但**失败在不同的地方**

这是全篇最有信息量的一题。

**运行 B（协议未修）**：模型走了 8 次工具，把整条链都摸清了，然后**停下来问用户**：

```
recommend → listDomains → describe(meeting-room-list) → describe(meeting-room-usage)
→ describe(meeting-application-prepare) → describe(meeting-application-submit)
→ describe(meeting-user-search) → describe(meeting-application-definition)
作答：outcome=clarify，missing=["meetingRoomId（会议室：想用哪一间 / 给个名称关键字）"]
```

它的 notes 原文：

> 时间（明天=2026-09-21 14:00:00~15:00:00）、会议名称（周会）、参会人数（2）都已从原话拿到，
> 唯一缺的是「哪间会议室」：`meeting-application-prepare/submit` 的 `meetingRoomId` 是搜索型长选项，
> D6 要求先向用户要关键字再查候选，不能无条件全量拉取、也不能替用户随便挑一间。
> 拿到关键字后打算走：`meeting-room-list`（按名称模糊查，取 `list[].id` 作为 `meetingRoomId`）
> → `meeting-room-usage`（用 date=2026-09-21 确认该时段空闲）→ `meeting-application-…`

**这就是 G2 的独立复现。** 上一轮的报告 §3② 说：人到这一步「差点去读 `src/catalog/` 确认字段名」。
真实模型读到的是同一堵墙：`consumption` 说「用 lookup 指定的能力查候选」，而 `lookup` 不存在，
`next`/`related` 也没有一条边指向 `meeting-room-list`。模型甚至点名引用了 H35 那条 warning。
它用掉了整整 8 次预算（刚好用满，没有超限）都没能迈过去。

**注意它其实「知道」答案**：它在 notes 里写出了 `meeting-room-list → meeting-room-usage → prepare → submit`
这条正确的路。但它是在前面几次探索里顺手看到 `meeting-room-list` 才知道的，
**不是这根链子告诉它的**——与人上一轮的处境一模一样。

**运行 A（协议已修）**：`lookup` 已登记、`related.upstream` 已把 `meeting-room-list` 接进来、
`next[0]` 也从 `definition` 改指 `prepare`。模型这次没有停下来问，走了 7 次工具，
链路完整（`required-chain` 绿），然后：

```
作答：outcome=call，capabilityId=meeting-room-list，args={pageNo:1, pageSize:20}
```

**它把落点写成了计划的第一步，而不是终点。** 用户给的 `meetingName/startTime/endTime/attendeeCount`
一个都没进 args。它自己的 notes 里明明写着完整计划（「先查会议室列表拿候选 meetingRoomId，
再查占用…然后 prepare（meetingName=周会、startTime=2026-09-21 14:00:00…）算审批人，最后 submit」）。

**判定：这次不是协议缺口，是模型的行为习惯**——它把「落点」理解成「我下一步要调的那个」，
而这份答案契约（沿用上一轮 `answers.mjs`）要求的是「这条链子的终点」。
两个运行合起来看：**修 G2 之前，模型卡在协议上；修完之后，模型卡在自己的计划粒度上。**
这是两种完全不同的失败，改进方向也不同。

#### T3 「订个会议室」— B PASS，A FAIL

**运行 B**：5 次工具，直接按 `submit` 的 `required` 清单问用户：
`meetingName / meetingRoomId / startTime / endTime / attendeeCount / date` —— 全过。
这复现了上一轮报告 §4「说清楚了」第 1 条：**`required` 标记可以无损翻译成澄清清单**，
模型一次就成了。这是协议最强的一处，对模型和对人一样有效。

**运行 A**：6 次工具，`outcome=clarify` 仍然对，但栽在两条上：

1. `clarification-covers` 红：它把 `meetingRoomId` 写成了 **`meetingRoomKeyword(会议室名称关键字)`**。
   协议里的字段名是唯一的机器锚点，模型一旦改写成自然语言，调用方就没法把它接回契约。
2. `no-forbidden-call` 红：它把 `meeting-application-submit`、`meeting-application-prepare`
   写进了 `chain` —— 但它**只是 `describe` 了一下**，并没有调用。

第 2 条尤其值得说：`chain` 的语义在协议/契约侧是歧义的。模型把它读成「我这一路上看过什么」，
判分把它读成「我这次要调什么」。**同一个模型行为，在 B 拿分、在 A 扣分**，
差别只是它在 A 顺手把「看过的东西」也写进了 `chain`。见 §5 N3。

#### T4 「帮我调薪」— 两轮都 PASS

| | 工具序列 | 作答 |
|---|---|---|
| A | `recommend` → `search("调薪")` → `describePage("3e7333")` → `listPages("salary")` → `listDomains()` | `unsupported`，pageRef=`/dashboard/salary/adjust/list（工资找齐）` |
| B | `recommend` → `search("调薪")` → `listPages("salary")` → `describePage(...)` → `listDomains()` → `search("工资调整")` | `unsupported`，pageRef=`/dashboard/salary/adjust/list` |

**两轮都过，且路径与上一轮人工作答几乎一致**：黑话命中「工资找齐」→ `describePage` 看到
`capabilities: []` + `pending: true` → 判「做不了」，同时把页面告诉用户。
模型没有被 `next: listPages(...)` 那条「继续逛」的边带跑（上一轮报告 §2 T4 担心的正是这一点），
它反而自己多逛了两下才收手。

模型 A 的 notes 里还把「不能用同域其它能力代替」这条说出了口 —— 说明 `warnings` 是有效的。

#### T5 「报销差旅费」— 两轮都 FAIL，且都撞上预算上限

| | 工具序列 | 作答 |
|---|---|---|
| A | `recommend` → `listDomains` → `search("报销差旅费")` → `search("差旅报销")` → `search("报销")` → `search("费用")` → `search("差旅")` → `search("费用报销")`（第 9 次被拒） | `unsupported`，chain=`["recommend","search"]` |
| B | `recommend` → `search("差旅费")` → `listDomains` → `search("报销")` → `search("差旅")` → `search("费用")` → `search("借款")` → `search("travel")`（第 9 次被拒） | `unsupported`，pageRef=`finance（财务域，含「费用分配」…）` |

两次都判出 `unsupported`（`outcome` 绿），但各栽在一条上：

- **A：`no-fabricated-capability` 红 —— `chain` 里写了 `["recommend","search"]`。**
  模型把**协议的工具名**当成了能力 id。见 §5 N4。
- **B：`no-page-claimed` 红 —— pageRef 填的是「财务域」的描述，不是页面。**
  目录里确实没有对应页面（`search` 全部 `total:0`），模型把一个域当成「相关页面」报了出来。
  这是对 `pageRef` 契约的越界，属于模型没看懂字段的边界。

**两轮都撞上 8 次预算上限**，而且都是在「证明否定」这件事上撞的。上一轮报告 §3⑤ 说人
「额外再调三次 `search` 才敢确认这不是分词问题」；模型调了 5 次。**运行 A 里协议已经给了
`recommend.ok === false` + 明确 reason**，模型也确实读到了（A 的 notes 原文引了
「recommend「报销差旅费」返回 ok=false、无匹配能力」），但它**仍然**继续连搜，
直到预算耗尽被强制收卷。见 §5 N6。

---

## 5. 模型的失败模式：是「协议没给出口」还是「模型没看懂」

这两者的改进方向完全不同，分开说。

### 5.1 协议没给出口（→ 改协议）

**只有一条，但它是最强的一条：G2 / `lookup` 缺失。**

运行 B 的 T2 是干净的证据：模型已经走到 `prepare`，知道要什么，也知道下一步该去哪查，
**但协议里没有任何一条边指向候选来源**，于是它只能回头问用户——而这恰恰是 D15 说的
「宁可多问一次」，所以它的行为在协议层面是**正确的**，只是这个任务要的是把事办成。
模型甚至点名引用了 H35（那条「长选项但没登记 lookup」的 warning）。

这是对整个 G2 判断的独立验证：**上一轮是人卡在这里，这一轮模型也卡在这里，用的还是同一份 warning。**

修完之后（运行 A）同一个任务确实迈过去了——模型不再回头问，而是直接去查列表。
**修复是有效的**，只是迈过去之后暴露了下一层的失败。

### 5.2 模型没看懂 / 行为习惯（→ 改措辞、改工具面、或改模型）

1. **落点的粒度（A 的 T2）**：`capabilityId` 是「终点」还是「下一步」？
   模型选了「下一步」。它的 notes 证明它想清楚了整条链，所以这不是理解力问题，
   是**答案契约对「落点」的措辞不够硬**。
2. **`chain` 的语义（A 的 T3、T5）**：模型读成「看过什么」，判分读成「要调什么」。
   同一个行为在 B 拿分、在 A 扣分。**这一条我认为责任在答案契约，不在模型。**
3. **工具名 vs 能力 id（A 的 T5）**：模型把 `recommend` / `search` 当能力 id 写进 `chain`。
   协议给模型的工具面是 6 个动词（`recommend`/`search`/`describe`/…），
   而能力 id 是另一套命名（`meeting-room-list`/…）。两套命名在同一上下文里并列出现，
   混淆是自然的。见 N4。
4. **字段名被改写成自然语言（A 的 T3）**：`meetingRoomId` → `meetingRoomKeyword(会议室名称关键字)`。
   模型在「给用户看的措辞」和「给机器用的标识符」之间没有切换。
5. **`pageRef` 的边界（B 的 T5）**：把「域」当成「页面」填进去。

**一句话区分**：真正需要改协议的只有 G2（已在改，且改对了）。
其余四条要么是答案契约的措辞问题，要么是模型自身的习惯。

### 5.3 「模型会不会用」

会。**协议最值钱的那几处，模型全都用上了**：

- `describe().params[].required` → 直接翻译成澄清清单（T3-B 一次过）
- `params[].description` 里的时间格式约束 → 模型的 `startTime` 写成 `2026-09-21 14:00:00`，
  分钟 00/30、秒 00 一次就对
- `search().matches[].via/from` → T4 两轮都靠它认出黑话「调薪」→「工资找齐」
- `write: true/false` → 模型自己说出了「submit 是写操作，必须带 requestId」
- `warnings[]` → 模型多次引用（H35、H36 类）
- `next[].why` → 模型跟着走了

它没用上的只有 `invoke`（因为不需要，见 N2）。

---

## 6. 与上一轮人工作答的逐题对比

| 题 | 人工作答（上一轮） | 模型（B，协议未修） | 模型（A，协议已修） |
|---|---|---|---|
| T1 | ✅ 靠读 title 纠正排序（G4） | ✅ 同样纠正 | ✅ 同样纠正 |
| T2 | ✅（判分口径下）走通链路，`meetingRoomId` 标 `deferred`，硬给 prepare→submit | ❌ 停在 `prepare` 前问用户 —— **与 G2 撞在同一处** | ❌ 走通链路但落点写成第一步 |
| T3 | ✅ 用 `required` 清单问 5 个 | ✅ 问 5 个 + date | ❌ `meetingRoomId` 被改名 + `chain` 越界 |
| T4 | ✅ 命中「工资找齐」报 unsupported | ✅ 同 | ✅ 同 |
| T5 | ✅ 连搜 3 次确认零命中 | ❌ 连搜 5 次撞上限，且把「域」当页面给了 | ❌ 连搜 5 次撞上限，`chain` 写了工具名 |
| **合计** | **5/5** | **3/5** | **2/5**（补跑三轮均为 2/5，见 §11） |

三点值得注意：

1. **T1 与 T4 上，模型和人的行为几乎逐字一致。** 这说明这两题的协议面是充分自解释的
   —— 换谁来看都会做同一件事。
2. **T3 是协议最成功的一处，对模型和对人一样有效**（B 一次过）。
   A 的失败原因不在协议，在 §5.2。
3. **T5 是协议最弱的一处，对模型比对人不友好。** 人要搜 3 次才敢下结论，模型搜了 5 次还撞上限。
   G5 的显式否定（`ok:false`）落地之后，模型确实读懂了否定（它引用了 `ok=false`），
   但**它仍然要自己再证一遍**。这说明「给出显式否定」和「让调用方敢就此收手」之间还差一步。

---

## 7. 我发现的、报告里没提到的新问题

**N1｜`chain` 的语义需要在协议/契约层被钉死。**
现在的答案契约里，`chain` 一处兼了三义：「我打算按什么顺序调」（判分想要）、
「我查过哪些能力」（模型常写）、「路上经过的能力」（字面）。后果是运行 A 的 T3 被
`no-forbidden-call` 判红 —— 模型只是 `describe` 了 `prepare` 和 `submit`，一个都没调。
**建议**：要么把「看过」和「要调」拆成两个字段（`inspected` / `plan`），
要么在协议侧就用现在新加的 `next[].role` 那种方式把它结构化。

**N2｜G1（执行绑定）在这一轮是测量盲区，不是「已验证」。**
本轮的答案契约里 `capabilityId` 直接就是句柄，模型不需要写出「怎么把这次调用发出去」。
两轮 10 次作答里，`invoke` / `sdkPath` / 方法名出现 **0 次**。
**要真正测 G1，答案契约必须要求模型给出一次可执行的调用**（方法路径 + 完整参数），
否则这一层永远是盲区。**不要**把本轮结果读成「G1 不重要」。

**N3｜协议的工具名与能力 id 会在模型脑子里串味。**
T5-A 的 `chain: ["recommend","search"]` 是最直接的证据。工具面是动词
（`recommend`/`search`/`describe`/`listPages`/`listDomains`/`describePage`），
能力 id 是名词短语（`meeting-room-list`）。建议工具名加前缀（如 `catalog_recommend`），
或者交卷时对 `chain` 做一次「必须是已注册能力 id」的即时校验并回错，让模型自己改。

**N4｜`ok:false` 没有解决「自证否定」的成本。**
这是 G5 修复的一个缺口。模型拿到了 `ok:false` 和 reason，仍然连搜 5 次到预算耗尽。
可能的原因：`recommend.ok:false` 只否定了「整句话术」，模型不确信「换个词是不是就有了」——
这在有多义词的中文里是合理的谨慎。**建议**：在 `ok:false` 的 reason 里直接给出
「已用哪些词试过、全目录共 N 个能力、都不匹配」这类**收敛性**信息，
或者提供一个 `catalog.confirmAbsent(keyword)` 之类的显式确认操作，
让「我确认没有了」变成一次调用就能拿到的结论。

**N5｜8 次预算对「下钻 + 否定」两类题偏紧。**
四次作答里三次贴到或撞上上限（B-T2 用满 8、A-T5 撞、B-T5 撞）。
D15 说的 4~6 轮预算，在真实模型的实际行为下是不够的。
**建议**：要么把预算提到 10~12 次，要么按题的 `kind` 分级
（`direct` 6 次、`drilldown`/`unsupported` 12 次）。后者更合理。

**N6｜修后的 `role` 标注在 `meeting-application-submit` 上像是反的。**
实测（运行 A 的构建）：

```
describe('meeting-application-submit').next =
  [ describe:next   {capabilityId: meeting-room-list}
  , describe:next   {capabilityId: meeting-user-search}     ← 订会议室链路用不到
  , describe:next   {capabilityId: meeting-application-cancel}  ← 更用不到
  , describe:detour {capabilityId: meeting-application-prepare} ← 这恰恰是真正的下一步
  , describePage:detour {pageId: /simple/hr/form/033}
  , listPages:detour {domain: simple} ]
```

`prepare` 是 `submit` 的**上游**（`prepare.related.downstream = ['meeting-application-submit']`），
所以从 `submit` 看它标 `detour` 在方向上是自洽的；但 `meeting-user-search` 与
`meeting-application-cancel` 标成 `next`（正路）就很难解释 —— 订会议室不需要查参会人，
也不需要取消。对比：`meeting-room-usage.next[0]` 已经从 `definition` 改成 `prepare`（改对了）。
**建议 owner 复核 `meeting-application-submit` 的 `next[].role` 取值。**
实测代价：运行 A 的 T2 多花了 1 次预算在 `describe(meeting-user-search)` 上。

**N7｜模型会把「用户给的信息」丢在半路。**
运行 A 的 T2 里，用户明确给了「周会 / 2点~3点 / 2个人」，模型的最终 `args` 里**一个都没有**。
它的 notes 里却写全了。这不是协议问题，但值得产品层注意：
**「想清楚了」和「写出来了」在模型身上是两件事**。
如果将来 `-llm` 有「提交前把载荷回执给上层」这一步（`describe().howToCall.notes` 里已经这么要求了），
这种「想到了没写」会被那一步拦住。

---

## 8. 装置本身的问题（自查）

1. **G1 测不到**（N2）—— 见上。
2. **答案契约的措辞会直接影响分数。** N1/N3 已经证明了这一点。
   下一轮如果继续用这套装置，建议把 `chain` 与「看过什么」分开，并在 prompt 里给一个**正例**。
3. **协议在评测期间被并行修改，是本轮最大的方法学风险。**
   我加了「协议指纹 + `--dist` 定版入口」来对冲：任何一轮运行都能事后回答
   「这份数字是协议哪一版跑出来的」。**建议以后所有涉及 `dist/` 的评测都带上指纹。**
4. **模型输出不可复现，所以没有任何一条真实运行被写成断言。**
   `test/eval-model.test.ts` 用的是确定性桩模型，钉的是「循环 / 脱敏 / 预算 / 判分对接」四件事。

---

## 9. 装置自检与反证

`test/eval-model.test.ts` 31 个用例，全部通过（`pnpm exec vitest run test/eval-` → 4 个文件 72 个用例）。
其中脱敏、预算护栏、落盘守卫三条都做了**故意改坏 → 变红 → 改回**的反证：

| 反证 | 改坏什么 | 变红的用例 |
|---|---|---|
| 1 | `recommend` 的返回值不过 `redact()` | 「六个目录工具全调一遍：模型收到的每一个字节里都不含内部字段」 |
| 2 | `describePage` 不过 `redact()` | 同上 + 「落盘的运行文件里也不含内部字段」 |
| 3 | 拿掉落盘前的泄露自检 | 「泄露自检：产物里混进内部字段时拒绝落盘，且不留下半个文件」 |
| 4 | 预算强制阈值从「2 轮后」退回「1 轮后」 | 「预算护栏：第 9 次目录调用被拒…」+「恰好用完 8 次预算、然后主动交卷：不算超限」 |
| 5 | 预算护栏整条拿掉（第 9 次仍放行） | 「预算护栏：第 9 次目录调用被拒…」 |

改回后 31 条全绿。

**反证 1 一开始是绿的** —— 第一版泄露测试只调了 `describe`/`describePage`/`listPages` 三个工具，
把 `recommend` 的脱敏拆掉它抓不到。这正是反证的价值：测试随即改成**六个目录工具全调一遍**，
并补了一条反空转断言（断言这四个返回的**原始**形态里确实有内部字段，否则「不泄露」是空的）。

---

## 10. 本次没有做的事（明确边界）

- 没有发任何对 Portal 后端的真实网络请求，没有使用任何 Portal 凭据。只连了模型 API。
- **没有修改 `src/**`**。运行 B 用的旧协议是把 `git archive HEAD` 解到 `/tmp` 单独构建的。
- **没有跑任何写 git 的命令**（`add` / `commit` / `stash` / `checkout` / `restore` / `worktree` 都没有；
  只用了只读的 `git status` / `git log` / `git diff` / `git archive`）。
- 没有改 `docs/eval-report.md`、`docs/roadmap.json`、`docs/usage.md`、`tools/generate/**`、`refs/**`。
- `tasks.mjs` / `scoring.mjs` / `consumer-view.mjs` / `answers.mjs` / `run.mjs` 一行未改。
- 没有跑全量 `pnpm test`（并行的代理在改 `src/catalog/**`、`src/http/**`）；只跑了 `test/eval-*`。
  `pnpm typecheck` 当前报的错误全部来自 `src/catalog/**` 与 `src/http/**` 的在途改动，与本装置无关
  （本装置相关的文件零错误）。
- `pnpm build` 按派单要求重试（20:47:35 / 20:48:36 两次失败，20:49:42 第三次成功）。

---

## 11. 稳定性样本：修复后又跑了两轮（本节为补跑）

派单方复核后指出：§4 的「修复前 3/5、修复后 2/5」**每边只有 n=1**，
不能据此说「修了反而变差」。那一题的差异（T3）看起来是模型把参数名改写成自然语言，
但**这只是推理，没有数据**。本节补两个样本，把它变成事实。

### 11.1 怎么跑的（与前面完全同条件）

- 版本：`454fc08`（「-llm 协议补上执行层」那个提交）
- 构建：`git archive 454fc08` 解到 `/tmp/portal-fixed-454fc08`，
  **在临时目录里单独 `tsc -p tsconfig.build.json`**，用 `--dist` 指过去跑。
  **没有在工作区 `pnpm build`**（当时有三个代理在并行改仓库，工作区构建随时可能被打断）。
- 口径：`tasks.mjs` / `scoring.mjs` / `consumer-view.mjs` / 预算护栏（8 次）/ 脱敏 / 记账 / 系统提示，
  **一处未动**。只给驱动器加了一个 `--label`（给产物文件名带上轮次），不影响任何判分。
- 装置自检：`pnpm exec vitest run test/eval-` → **74/74 绿**（比上一版多 2 条，是新加的 label 测试）。
- 落盘：`tools/eval/model-runs/round2-fixed-*.json`、`round3-fixed-*.json`。

**三份样本可比吗？** 可比的依据是**协议指纹**：

| | `hasInvokeBinding` | `hasLookup` | `hasEdgeRole` | `hasIntentSignal` | `hasExplicitNegative` | `nextStepKeys` |
|---|---|---|---|---|---|---|
| round1-fixed（工作区在途构建 20:49:42） | ✅ | ✅ | ✅ | ✅ | ✅ | `args,role,tool,why` |
| round2-fixed（`454fc08` 隔离构建） | ✅ | ✅ | ✅ | ✅ | ✅ | `args,role,tool,why` |
| round3-fixed（`454fc08` 隔离构建） | ✅ | ✅ | ✅ | ✅ | ✅ | `args,role,tool,why` |

三项 `*Keys` 列表与五项布尔逐项相同 ⇒ round1 虽然构建自工作区在途状态，
**协议面与 `454fc08` 一致**，三轮可以放在一起看。

### 11.2 逐题稳定性表（修复后三轮）

| 题 | round1 | round2 | round3 | 稳定性 | 失败原因各轮是否相同 |
|---|---|---|---|---|---|
| **T1** 查会议室有哪些 | ✅ | ✅ | ✅ | **稳定绿 3/3** | — |
| **T2** 订明天的会议室 | ❌ | ❌ | ❌ | **稳定红 0/3** | **不同**（见 11.4） |
| **T3** 订个会议室 | ❌ | ❌ | ❌ | **稳定红 0/3** | 相同（三轮都是 `no-forbidden-call`） |
| **T4** 帮我调薪 | ✅ | ✅ | ✅ | **稳定绿 3/3** | — |
| **T5** 报销差旅费 | ❌ | ❌ | ❌ | **稳定红 0/3** | **不同**（见 11.5） |
| **合计** | **2/5** | **2/5** | **2/5** | **稳定 2/5** | — |

**判分结果本身是稳的**：三轮 5 题的红绿完全一致，没有一题在翻。
不稳的是**红的理由**——T2 与 T5 每轮败在不同的地方。

路径稳定性也值得记一笔：**T1 三轮的工具序列逐字相同**
（`recommend → search("会议室") → describe(meeting-room-list)`，args 都是 `pageNo=1, pageSize=10`）；
**T4 是 `recommend → search("调薪") → describePage`**（round3 只用 3 次工具，round1 用了 5 次），
末态一致但过程有冗余。

### 11.3 账

| 轮次 | 输入 | 输出 | 缓存读 | 请求 | 总 token | 判分 |
|---|---|---|---|---|---|---|
| prefix-control（修复前，对照） | 62,056 | 4,796 | 31,360 | 17 | 98,212 | 3/5 |
| round1-fixed | 62,180 | 9,102 | 70,528 | 18 | 141,810 | 2/5 |
| round2-fixed | 87,352 | 9,429 | 76,160 | 18 | 172,941 | 2/5 |
| round3-fixed | 69,653 | 9,121 | 73,088 | 18 | 151,862 | 2/5 |
| **修复后三轮合计** | **219,185** | **27,652** | **219,776** | **54** | **466,613** | **2/5 / 2/5 / 2/5** |

四轮（含对照）总计 **564,825 token / 71 次请求**。另有开发期预热与探针约 5.5K token 未计。

**报告数字时必须带上的话**：

> **修复前只有 n=1，不足以支撑「修复让分数变差」这个结论。**
> 修复后的三轮虽然稳定停在 2/5，但 2/5 与 3/5 的差别**只在 T3 一题**，
> 而 T3 在三轮里的失败原因**自始至终是同一条 `no-forbidden-call`**，
> 这条又是本装置答案契约里 `chain` 语义歧义造成的（见 §5 N1）——
> 也就是说，**这个差别极可能根本不来自协议修复**。
> 要坐实「修复前后到底有没有差」，正确做法是把修复前的协议也跑满 3 轮，
> 本轮的对照 n=1 **不能**用来下任何结论。

### 11.4 T2 三轮分别败在哪（这是本节最有价值的部分）

T2 三轮全红，但**红的方式完全不同**——只看红/绿会丢掉全部信息。

| 轮次 | 落点 `capabilityId` | `args` | 工具/轮 | 败因 |
|---|---|---|---|---|
| round1 | `meeting-room-list`（链路第 1 步） | `pageNo`、`pageSize` | 7/4 | 落点错 + 7 条 argRules 全缺 |
| round2 | `meeting-room-usage`（第 2 步） | **6 个全给全对**（见下） | 6/4 | 落点错 + `required-chain` 漏了 `meeting-room-list` |
| round3 | `meeting-room-list`（第 1 步） | `pageNo`、`pageSize` | 8/4（撞上限） | 落点错 + 7 条 argRules 全缺 |
| prefix-control（对照） | — | 无（作答是 `clarify`） | 8/3 | 回头问用户要会议室 |

**round2 是四轮里最接近的一次**，值得单独看：

```
capabilityId: meeting-room-usage          ← 唯一的错
args:
  date          = 2026-09-21              ← 「明天」+ 基准日，格式按 kind=date
  meetingRoomId = (deferred)              ← 写清「本次 usage 返回里挑 14:00-15:00 无 timeSlot 的那间」
  meetingName   = 周会                    ← 用户原话
  startTime     = 2026-09-21 14:00:00     ← 分钟 00、秒 00，一次就对
  endTime       = 2026-09-21 15:00:00
  attendeeCount = 2
notes: 「…拿到后进 meeting-application-prepare 问后端要人工指定审批人节点（tasks），
        再连同 payload 走 meeting-application-submit 提交（submit 为写操作，需带 requestId）」
```

**它把整条链想对了、参数也全部给对且都有出处，唯一没做对的是「落点该填终点还是下一步」。**

三轮的落点分别是：`list` → `usage` → `list`。**一次都没有填 `submit`。**
这不是噪声，是一个稳定的行为倾向：**模型把 `capabilityId` 读成「我下一步要调的那个」，
而不是「这条链的终点」。** §5.2 第 1 条当时只有 1 个样本，现在有 3 个（加上对照是 4 个，且对照那次它选择回头问）。

### 11.5 T5 三轮分别败在哪

| 轮次 | `outcome` | `chain` | `pageRef` | 工具/轮 | 败因 |
|---|---|---|---|---|---|
| round1 | `unsupported` ✅ | `["recommend","search"]` | 无 | 8/4（撞上限） | `no-fabricated-capability` |
| round2 | `unsupported` ✅ | `["recommend","search"]` | 无 | 8/5（正好用满） | `no-fabricated-capability` |
| round3 | `unsupported` ✅ | 无 | `/dashboard/finance/expenditure/expense-application-review/list` | 6/5 | `no-page-claimed` |
| prefix-control | `unsupported` ✅ | 无 | `finance（财务域，…）` | 8/4（撞上限） | `no-page-claimed` |

**四轮全部判出 `unsupported`（`outcome` 四次全绿），四轮全红在周边字段上**，
而且红的理由是三种不同的：

1. **`chain` 里写工具名**（round1、round2 两次）—— 见 §5 N3。
   两轮完全一致，说明这不是偶发。
2. **`pageRef` 填了一个真实存在的页面**（round3）。
3. **`pageRef` 填了一个域的描述**（对照轮）。

第 2 条是**本轮新发现的、之前没写过的问题**，见 §11.6。

还有一条稳定的成本现象：**四轮里三轮把 8 次预算用满或撞上限**，
且都花在「证明否定」上（连搜 5 次上下）。§5 N4 说的「`ok:false` 减少了歧义、没减少成本」，
现在有 4 个样本。

### 11.6 新发现：T5 的 `pageRef` 规则与协议自身的导航能力有冲突

round3 里模型给出的 `/dashboard/finance/expenditure/expense-application-review/list`
**不是编造的**——它是模型用 `listDomains → listPages` 一层层翻出来的一个真实页面
（「费用申请审核」，语义上确实和「报销差旅费」相关）。

但 T5 的期望是 `acceptablePageRefs: []` + `expectZeroSearchHits: true`，
judge 于是判 `no-page-claimed` 红。

**这两件事同时成立，说明它们是矛盾的**：

- 任务的隐含前提是「零命中 ⇒ 连页面都不该给」。这个前提对**字面检索**（`search`）是成立的。
- 但协议同时提供了**导航式发现**（`listDomains → listPages`），
  这条路能翻出字面检索命中不到、语义上却相关的页面。
- 于是模型越会**用协议**（真的去翻目录），越容易在这题上被判红。

上一轮报告 §5「建议 6」主张的恰恰是「`suggestions` 用相关性排序」——
也就是**希望协议能给出这种相关页面**。现在协议给了（经由导航），任务却罚它。
**这不是模型的错，也不是判分器的错，是任务设计与协议方向之间的一个未对齐点**，
建议 owner 复核 T5 的 `acceptablePageRefs` 口径：
要么允许「相关但无能力」的页面，要么把「不许给页面」限定在 `search` 路径上。

（我**没有改** `tasks.mjs`——按派单要求，本轮只补样本、不动口径。）

### 11.7 本节的小结

1. **判分是稳的**：修复后三轮 2/5 / 2/5 / 2/5，红绿分布完全一致，没有一题在翻。
2. **不稳的是失败理由**：T2 与 T5 每轮败在不同地方，**红/绿会掩盖这件事**。
3. **T2 的 `capabilityId` 三轮都没填对终点**（`list`→`usage`→`list`），
   这是一个稳定的行为倾向，不是噪声 —— §5.2 的推断现在有 3 个样本支撑。
4. **T3 三轮都红在同一条 `no-forbidden-call`**，而这条源于答案契约的 `chain` 歧义。
   **「修复前 3/5 vs 修复后 2/5」的全部差别就在 T3 这一题，且极可能与协议修复无关。**
5. **n=1 的对照不能用来下结论。** 要把「修复到底有没有让分数变化」变成事实，
   需要把修复前协议也跑满 3 轮——这是下一轮该补的样本，不是本轮能回答的。
