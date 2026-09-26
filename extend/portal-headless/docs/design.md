# Portal 服务端无头化 —— 设计（隐藏设计点与待决问题）

| 项 | 内容 |
| --- | --- |
| 记录时间 | 2026-09-20 |
| 依据代码（**结论形成时**） | `/Users/liyang/Documents/code/wdbc/Projects_Js`，分支 `fix/portal/4.6.3.22-修改绩效公式配置错误权限声明`，HEAD `b8dbcae67`。**本文 2026-09-20/21 的全部结论读自这份检出，未在新检出上复核**（且该检出落后线上 435 个提交，见 `docs/conventions.md` 第 31 条） |
| 来源声明（**2026-09-22 起**） | `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`，分支 `test/portal/main`，HEAD `82651c98c5`。生成器的 `PORTAL_REPO` 默认值已指向它（见 `docs/conventions.md` 第 32 条）。**只换来源，不代表本文结论已据此复核** |
| 参考 | 同目录 `portal-无头化-发现记录.md`（分析基线 `f096a38fb4`，行号可能已小幅漂移） |
| SY 侧依据 | `/Users/liyang/Documents/code/github/Synapse`，`docs/superpowers/specs/2026-09-03-builtin-mcp-skill-connectors-design.md` |

## 本文的校对状态（最后对齐 2026-09-20）

本文是**滚动更新的设计记录**，不是一次性定稿。读之前先看这一节，它告诉你每一部分该信到什么程度。

| 部分 | 校对到什么程度 |
| --- | --- |
| §1b 决策记录 D1–D36 | **历史存档**。每条是"决策当时是什么"，不随实测改写。依据后来被推翻的，**在它旁边加了 `⚠️ 实测校正` 标注**——看到标注就必须读它，标注里写明了哪一点不成立、现在的实测是什么、以及**这条决策本身还成不成立**。 |
| §1c 实施路径与进度 | **进度快照**。表里每条自带提交号，最后对齐到 `17482ce`（批量生成器实测）。**以提交号为准，不以本表为准。** |
| §1d 模板聚类与清单 | **已与实测对齐**（2026-09-20）。原始结论「463 可批量」已证伪，更正块在「关键结论」之后；**引用本节任何数字前先读那个更正块**。 |
| §2 代码事实 F1–F26 | F19 / F20 已按后端仓库查证并改写，其余按 `文件:行号` 为依据；未逐条复核。 |
| §3 隐藏设计点 H1–H42 | **H2 加了 `⚠️ 实测校正`**；**H3 / H13 / H35 加了实测校正**（axios 实例数、补前缀规则、`lookup`）；H33 原本就有实测更正块，H34 / §5b 已回指它。其余各条是**设计提问，不是事实陈述**——尤其"要你定的问题"下的那段"我的建议"只是当时的建议。 |
| §4 问题速览 | 答复列里已被后续实测回答的，直接回填并注明依据；空着的就是没答。 |
| §5 待补充 | 最后对齐到同一批实测；仍挂在"仍需后端/平台配合"下的，都还没答。 |

**本文不是唯一的事实来源。** 与下面这些冲突时，以下面为准——它们由生成器或测试产出，比手写的这里更难腐烂：

- `docs/conventions.md` —— 忘了代价最大的硬约束，每条带出处
- `src/context/README.md` —— 页面上下文的两个推导（`module-type` / http 实例）的实测画像
- `generated/page-catalog.json`、`generated/module-type-rules.json` —— 清单与规则表本体
- `src/capabilities/generated/batch-report.json` —— 批量生成器的实测判定
- `docs/eval-report.md`、`docs/eval-model-report.md` —— `-llm` 协议的黑盒评测（人工作答 / 真实模型）
- `docs/roadmap.json` —— 人工维护的"这条链上哪些环节已建成"

**只有本文说过、别处查不到的东西，按「未复核」处理**——本文不删它们，但也不会为了"看起来一致"把它们改成推测。

## 0. 本文怎么用

- 第 1 节是你录音里的设计，我按原文归纳成 A1–A7，后文用编号指位。
- 第 2 节是读代码核对出的、**会直接改写设计**的几个事实。
- 第 3 节是**你的设计里没有提到、但代码里真实存在**的隐藏设计点，编号 H1–H16。每个都带代码依据、为什么重要、以及**要你拍板的问题**。
- 第 4 节是问题速览表（Q1–Q16），你答复后我直接回填到表里，并把结论并回第 3 节。
- 你每答一轮，本文更新一次，结论沉淀在第 3、4 节，不另开文件。

标注约定：**[代码]** 有文件行号可直接核对；**[推断]** 由代码事实推出，需你确认；**[后端]** 前端代码里看不到，需要后端或产品确认。

---

## 1. 你的设计基线（录音归纳）

| 编号 | 你的设计 |
| --- | --- |
| A1 | Portal 无头版是**跑在服务端的 SDK**，不依赖任何数据库存储 |
| A2 | 用户带 SY ID + Portal Token 请求 SY 服务端，SY 服务端内部调用该 SDK |
| A3 | SDK 内有**内存缓存**，有效期可配置（10/30 分钟），缓存"该 SY 用户下哪个 Token 已用过"以及登录后拿到的权限列表；等价于"浏览器打开 Portal 不关标签页"的会话级缓存 |
| A4 | 连接流程：SY 客户端连接器开开关 → 唤起浏览器打开 Portal 指定路由 → 路由接收 4 个参数（SDK 版本、客户端本地临时密钥、SY 客户端版本、回调地址）→ 校验版本与密钥 → 拼回调地址带 token + 租户唤起客户端 → 客户端本地保存 |
| A5 | 调用流程：Synapse skill 读本地连接器保存的租户和 token → 调 SY 服务端接口 → 服务端实例化 SDK → 等价于浏览器里的用户 |
| A6 | 面向 AI 的接口规范：统一前缀 `Plugin/Portal-Headless/`，`{页面名}-list` 给数据，`{页面名}-list-llm` 给"怎么用"的说明；响应在 `data/code/message` 之外增加 `llm` 字段，供 AI 读失败原因、字段建议、规则约束和下一步可调用的接口 |
| A7 | 版本对齐：SDK 版本与 Portal 网页正式版**严格相等**；靠对比网页端新旧提交记录、过滤纯 UI 变更来同步；连接器鉴权阶段 Portal 页面读后台 SDK 版本，不匹配就不下发 token |

---

## 1b. 决策记录

### 第 1 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D1 | 凭据方案 | **浏览器回调拿会话 token**（维持 A4 原设计，不采用私人令牌） | 凭据是用户全量权限，无 scope、无独立吊销入口、无最近使用记录。由此新增的必答项见 §3.5 |
| D2 | 能力边界 | **Portal 全部页面** | 能力目录必须由 SY 侧从 Portal 代码/菜单生成，不能依赖平台管理员人工登记；覆盖面约 850 个菜单页、2,736 个去重接口路径 |
| D3 | 一期系统范围 | **只做 Portal 主后端**（`VITE_ZHDJ_PLATFORM_API` → `/admin-api`） | 排除 iframe 内 BPM 引擎与 17 个独立域名系统；H3 降为"边界说明"而非待决 |
| D4 | 写操作 | **全部放开，等价于用户本人在浏览器操作** | 不做风险分级、不强制人工确认。H4 从"要不要放开"变成"放开后必须补什么" |

> 说明：D1/D2/D4 与我原先的建议相反。下面各条里凡是与本决策冲突的"我的建议"都已标注 **[已被 D1/D2/D4 覆盖]**，保留原文是为了记录取舍过程；实施口径以本节为准。

> ⚠️ 实测校正（2026-09-20，**只针对 D3 里的那个数，D3 的结论不变**）：D3 写"排除 iframe 内 BPM 引擎与 **17 个**独立域名系统"。
> 实测：`app/portal/utils/http/` 下是 **17 个文件、18 个 axios 实例**（`zhdj-cms.js` 一个文件导出 `http` 与 `httpLay` 两个绑定，`:106-107`）；**"一个实例"的单位是导出的绑定，不是文件**。
> 更要紧的是它们**不全是"独立域名"**：其中 **4 个与主后端同 host 不同前缀**（`sale` → `/admin-shop-api`、`platform-mall-admin` → `/mall-manage-api`、`mall-app` → `/mall-api`、`crm` → `/admin-crm-api`），其余才是完全不同的 host（含养鸡 MES、教育等其它产品线）。
> 出处：`src/context/README.md` §1a/§1b（逐实例画像，带 `文件:行号`）、`docs/conventions.md` 第 24–29 条。**D3 的决定本身不变**——反倒因为"同 host 不同前缀"这一批的存在，D3 那条范围边界现在有了实测支撑，并且它挡住的正是一个悬而未决的范围问题（见 §1d 更正块末尾）。

### 第 2 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D5 | 短信验证闸门 | **把闸门搬到 SY 客户端** | SDK 返回"这一步需要短信验证"，用户在 SY 客户端输验证码后继续。安全门保留，代价是 AI 的流程会**中断等人** |
| D6 | 长选项参数 | **按类型分别处理**：2–3 项的小枚举直接列给 AI；上百上千项的大选项集不一次返回，先问用户关键字，用户不知道就先列前几级或给出选项，AI 拿关键字去搜索匹配。列表查询若无需搜索条件即可查就直接返回 | 参数需要**分类型**，这是新的设计单元，见 H35 |
| D7 | 数据边界 | **不做限制，全部可读** | Portal 的薪酬/绩效/财务数据会进对话历史、手机端实时中继、以及第三方模型 |
| D8 | 能力检索 | **菜单清单（仅侧边栏可见的）+ 路由推荐**，由**服务端下发、实时更新**；本机 Synapse Skill 只负责向服务端渐进索要这些动态信息 | 能力目录**不是静态文档，是服务端下发的动态数据**；A6 的 `-list-llm` 因此应重新理解为"实时下发的目录 + 路由推荐"，而不是一次性生成的说明文档。见 H36 |

> **D8 的一句话总结（你的原话口径）**：Skill 是从本机加载的壳，能力目录是从服务器下发的、实时更新的数据；"怎么向服务器渐进索要"这件事写在本机 Skill 里。

> ⚠️ 实测校正（2026-09-20，**D8 的结论不变，变的是"怎么算可见"**）：D8 里"菜单清单（**仅侧边栏可见的**）"这个过滤依据，实测有两处要改写。
> 1. **接口是现成的**（F18）：`GET /admin-api/sys/menu/nav?project=` 返回的就是按当前用户过滤的菜单树。原文当时以为要新做，是猜错了（Q104）。
> 2. **但菜单树不是权限裁决。** 实测某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，而该能力是可调的——**拿菜单树预判 403 会把能用的能力藏起来**。所以它的定位只能是"下发面收敛"，不能当权限判断。
> 3. **连接键不是路径。** 菜单节点的 `url` **恒为 null**，页面路径实际在 `permissions` 字段里，且**从不是逗号分隔**（与 DTO 注释不符）。所以是「目录 `permission` ↔ 菜单 `permissions`」，不是「`menuPath` ↔ 菜单路径」。本文手里那份基线（`baseline/menu-nav.sample.json`，57 个节点）自己就写着 `nodesWithUrl: 0`、`nodesWithCommaSeparatedPermissions: 0`；**全量口径的"2,848 个节点里逗号 0 次"取自 `docs/conventions.md` 第 16 条，本次未复算。**
>
> 出处：`docs/conventions.md` 第 15、16 条，`src/catalog/visibility.ts`，基线 `baseline/menu-nav.sample.json`。

### 第 3 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D9 | 流程表单怎么进目录 | **不预先平铺，而是"发起流程"页面本身提供一个能力**。用户说"发起什么什么流程"，路由先把他引到发起流程列表页，那个页面的能力返回"当前用户可以发起哪些流程、有哪些流程表单、有哪些审核表单、有哪些审批表单"，再逐级往下 | 能力目录是**分层下钻**的，不是一张平表。已实测到对应的后端接口：`GET /bpm/process-definition/create-list`，返回按用户过滤的分组流程定义，字段含 `name / key / formCustomCreatePath / formType / baseUrl / category`——正好是"表单/审核/审批"的区分依据。**我上一轮问的"112 个表单要不要平铺进目录"因此不成立，Q100 作废** |
| D10 | 参数类型（枚举/搜索型/树型）谁来标 | 指向后端仓库 `/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java`（完整后端，固定分支 `test/test`；2026-09-22 前指向旧的 `Mall_Platform_Java_Dev@dev`） | 标注方由后端已有能力决定，正在调研，结果回填到 H35/Q95 |
| D11 | 路由推荐的维护方 | **由 Portal Headless SDK 自己提供**，通过一个接口动态下发给本机 Skill | 不复用 Portal 的 `intent`（Q105 作废）；SDK 既然是"对 Portal 网页端做扫描抽象"的产物，它天然知道路由，推荐也由它算 |
| D12 | 幂等 | 写能力**必带 `requestId`**，SDK 在 TTL 窗口内去重 | 不依赖后端改造就能挡住大部分重试；真正的幂等仍建议后端做，作为长期项 |

> **本轮新增的可信源**：后端仓库打开了。之前标 **[后端]** 的十几条（Q1、Q24、Q64–Q67、Q104…）现在可以直接查证，不再需要你去问人。三个方向的调研已在跑：① 私人令牌与开放接口的鉴权/scope 落实；② 登录态/菜单/权限/租户/模块类型；③ BPM 与发起流程、审批人、会议室冲突校验。

### 第 4 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D13 | SDK 形态 | **构建时全部烘进 SDK** | 目录、能力、参数契约在构建时就固化在产物里。**注意**：结构可以烘死，但"当前用户能看到哪些菜单、能发起哪些流程"是运行时数据，只能运行时取——见 §2b 的 F9 |
| D14 | "路由"在无头下的语义 | **它就是 SDK 内部的一个概念，不是导航**。SDK 提供接口告诉 AI"流程列表页这个能力该怎么调、能查列表页的什么"；AI 调了列表接口拿到数据后，**在同一个接口后加 `-llm`** 就知道这批数据该怎么消费、列表里哪一项对应哪个流程表单 ID；再拿表单 ID 进入另一个抽象的"流程表单领域"，**再调那个领域的 `-llm`** 知道这个表单有哪些字段、字段规则是什么、填什么、什么会变、什么是选项 | 这是目前对 A6 最完整的一次澄清：**`-llm` 不是文档，是"这个数据域怎么消费 + 下一步去哪"的协议**；整个能力体系是**逐级下钻的抽象域**，与真实页面/路由解耦。Q107 据此作废 |
| D15 | 一次任务的往返预算 | **不设上限，优先保准确** | 允许"选能力 → 查可发起流程 → 选审批人 → 短信验证"这种 4–6 轮链路；代价是慢和贵，换来不替用户乱选 |

> ⚠️ 实测校正（2026-09-20，**两条决策本身都保留，改的是它们对自己交付物的描述**）：
>
> **D14**：它说 `-llm` 能告诉 AI"这个能力**该怎么调**"。黑盒评测实测：当时的 `describe()` **不返回任何执行绑定**（拿不到方法名 / HTTP 细节 / 通用 invoke），能力 id 在整个目录输出里没有一处映射到方法名——判为**阻断**（G1，`docs/eval-report.md`）。**已修**（`src/capabilities/invoke.ts`、`describe().invoke`），但**修复本身没有被真实模型验证过**：`docs/eval-model-report.md` N2 指出那一轮的答案契约里 `capabilityId` 就是句柄，模型根本不需要写"怎么发出去"，所以那是**测量盲区**，不是"已验证"。详见 §1c 三条线表下的实测校正。
>
> **D15**：它给的"4–6 轮链路"预算是**不足的**。真实模型跑同一批任务，**四次作答里有三次贴到或撞上 8 次目录调用的上限**（`docs/eval-model-report.md` N5：B-T2 用满 8、A-T5 撞、B-T5 撞）。D15 说"不设上限"，但评测装置按 8 次设了护栏，于是"不设上限"这条在装置里没有被体现出来。**建议按题的难度分级放宽（如 `drilldown`/`unsupported` 类给 12 次）**，这只是建议，**尚未决策**。

### 第 5 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D16 | 短信闸门怎么办 | **让 SDK 遵守前端浏览器的逻辑** | SDK 复刻浏览器那一套：调 `/sys/sms/send` 触发发码 → 用户在自己手机上看码 → 用户把码给 AI → SDK 调 `/sys/sms/checkSms` 校验 → 通过后继续。**这道门的性质是"用户知情同意闸门"，不是安全边界**（因为它挡不住绕过浏览器的人），这个定位是准确的，实现上也完全可行 |
| D17 | 凭据生命周期（改密不失效、停用不即时、最坏 7 天） | **接受现状** | 不再推动后端加撤销；SDK 侧不做额外补偿 |
| D18 | 能力目录的来源 | **与后端无关。完全借助 Portal 前端代码（Projects_Js）推导出 SDK 的全部内容，后端代码只作辅助。** 实施分阶段：① 先做成一个**独立的包**，不直接进 SY 后端业务；② 这个包**自带测试用例，可做自动化测试**；③ 包测到完全没问题之后，才应用到 SY 后端；④ 那时再设计 SY 的路由前缀与接入方式 | Q47（路由前缀）、Q48（能力登记）**推迟到阶段 ④**；Q52（与 `system_open_api` 对齐）**自然作废**——不共用那张表。SY 的能力目录就是独立的一份，来源是前端代码 |

### 第 6 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D19 | 独立包的形态 | **TypeScript 包** | 与 Portal 前端同为 JS 生态，可直接参考/复用前端的 http 层、renren、菜单常量；将来嵌进 SY 后端（也是 TS）零成本 |
| D20 | "做对了"的标准 | **与浏览器发出的请求逐字段一致** | 需要一份"基准请求"作为正确答案，来源见 D21。这条把 SDK 的质量定义成**请求等价**，而不是"结果看起来对" |
| D21 | 测试环境 | SDK **初始化时接收一个 `BaseURL` 参数**，通过它连接不同环境；测试统一连测试环境。**并且会用 AI 的浏览器控制能力**：做某个页面时，让 AI 打开该页面的真实浏览器页面，了解真实布局与真实操作步骤，辅助构建 SDK 的这一部分 | ① 多环境成为一等公民，直接影响版本对齐（见 H37）；② **构建方式变了**：不再是纯静态扫代码，而是"AI 看真实页面 + 抓真实请求 → 生成能力与参数契约"。这同时回答了 Q88/Q95（参数契约谁生成）——**由 AI 观察真实页面生成**，这也正是 D20 需要的基准来源 |
| D22 | 阶段①的起点 | **先做目录生成**（页面 → 能力 → 参数契约 → module-type） | 不碰真实数据，且是后续一切的输入 |

> **D20 + D21 合起来是一套完整方法论**：AI 驱动浏览器打开页面 → 抓下真实请求（得到逐字段基准）→ 观察真实布局与操作步骤（得到参数语义：哪个是搜索型、哪个是树型、哪些必填）→ 生成 SDK 的能力定义 → 用同一份基准做回归。**这比从 5,352 个 `.vue` 静态推导可靠得多**，也解释了为什么 D18 说"后端代码只作辅助"——真正的依据是运行中的页面。

### 第 7 轮（2026-09-20）

| 编号 | 决策 | 结论 | 对设计的影响 |
| --- | --- | --- | --- |
| D23 | 环境 | 开发 / 测试 / 正式三种。**BaseURL 与 SDK 本身不绑定，它写在测试用例里**；SDK 在 SY 服务端正式启用时，初始化传入 prod 的 BaseURL | H37 的"多环境"降级为一条约定：SDK 自身无环境概念，**环境一致性由调用方保证**。这也意味着"版本对齐"不能指望 SDK 自己去比，得由接入方传对 BaseURL |
| D24 | 阶段① 的推进方式 | **先派多个 Agent 扫描 Portal 的实际菜单与代码，生成一份「页面的唯一参考清单」**（可能非常长），然后**从清单从上往下逐个推进**——它就是一份待办列表，今天做前三个，明天做第四个，逐个推进 | 阶段①的第一个交付物被明确了：**页面唯一参考清单**。它同时是进度表、验收凭据和工作分配单位 |
| D25 | 哪些页面走"AI 打开真实页面" | **所有页面都走** | 没有"只做写操作"的取舍，每个页面都要过一遍真实浏览器。见 H42 的量级估算 |
| D26 | AI 看页面的产出物 | **能力定义 + 参数契约 + 基准请求 + 操作步骤文档**（四件套） | 每个页面的交付物被定义清楚了。操作步骤文档是给 AI 理解业务语义用的，也是唯一没有机器校验的部分 |

### 第 8 轮（2026-09-20）

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D27 | 先聚类再定推进方式 | **先做模板聚类**（结果见 §1d） |
| D28 | 清单口径 | **菜单叶子 + 流程表单**（排除 2,757 条非菜单路由） |
| D29 | 阶段① 目标 | **先验证方法 + 跑通一条完整业务线**，不是一次覆盖全部 |
| D30 | 时间预算 | 暂无硬预算，以质量为先 |

---

## 1c. 实施路径（D18）

```text
阶段 ①  独立的包（不属于 SY 后端业务）
         └─ 内容全部由 Portal 前端代码推导：页面、能力、参数契约、module-type、路由推荐
         └─ 后端仓库只作辅助校验（本设计第 2b 节的后端查证结论即此类辅助）

阶段 ②  包自带测试用例 + 自动化测试
         └─ 跑通之前不进任何业务代码

阶段 ③  接入 SY 后端
         └─ 把包嵌入 SY 服务端，作为 Portal 能力的运行时

阶段 ④  设计 SY 的路由前缀与接入方式
         └─ 此时才定 `Plugin/Portal-Headless/` 这类前缀（H18/Q47）
```

> 这个顺序把最大的不确定性（"SDK 能不能真的驱动 Portal"）放在**离生产最远**的阶段，是对的。同时它把 H15（Synapse 连接器概念）、H18（路由前缀）、H31（跨团队排期）都推到了阶段 ③④，**目前不需要答案**。

### 阶段① 进度

| 项 | 状态 |
| --- | --- |
| 包位置 | `/Users/liyang/Documents/code/wdbc/portal-headless`（决策：独立仓库） |
| 工程选型 | pnpm + TypeScript + vitest（与 Synapse 后端一致） |
| 模板聚类 | 已完成，结果见 §1d |
| 页面唯一参考清单 | 已交付 1,019 行 |
| 包骨架 | **已建成**，提交 `1568e3f` |
| 生成器 | 已从临时脚本转正为 `tools/generate/generate.mjs`，产出 `generated/module-type-rules.json`（27 条规则）与 `generated/page-catalog.json`（1,019 行，其中 592 行能推出 module-type） |
| 请求层 | 已复刻：`/admin-api` 前缀、四个请求头、GET 的 `_t` 与 qs 序列化、`{ret, code, msg, data}` 包络 |
| 第一条能力 | 会议室列表（读）已实现 |
| 第二条能力 | 会议室预定表单（读）已实现，四件套见包内 `docs/pages/会议室预定.md`（提交 `bf236ea`）。**又抓到一个 bug**：占用查询的路径写成了 `/hr/meeting-room-usage`，真实是 `/hr/meeting-application/meeting-room-usage` |
| 长选项参数 | 已落地保护：`searchUsers()` 强制要求关键字或部门，拒绝 `pageSize=-1`。**依据是实测**——页面为填人员选择器，用 `simple-page?pageNo=N&pageSize=500` 连拉 9 页约 4500 个用户；浏览器里是"能用但慢"，无头下会直接冲掉 AI 上下文 |
| **写链路** | **已在测试环境端到端验证**（提交 `784830b`）：提交前该时段为空 → `prepare()` 返回 0 个需人工指定的审批人节点 → `submit()` 成功、后端返回新单据 id → 占用查询出现该预定 → `cancelReservation()` 后恢复为空。测试单已撤销，环境干净 |
| 写链路的第三个 bug | `roomUsage()` 的返回类型又写错了：实测是 `{ organizationId, date, meetingRooms }` **对象**，不是会议室数组。已修正 |

> **写链路的验证方式与读链路不同，这点要记清楚**：读链路的基准是"浏览器真实发出的请求"（browser baseline），写链路没有拿到浏览器提交的基准——antd 的日期区间选择器无法用 `fill` 驱动，UI 填表没走通。写链路的依据是"**SDK 真调成功、且被独立接口（占用查询）证实**"，记录在 `baseline/meeting-application-write.verified.json`。两种证据强度不同，不要混为一谈。
>
> **`prepare()` 的真实回包也从接口层面确认了 H33 的更正**：会议室流程需要人工指定审批人的节点是 **0 个**。
>
> ⚠️ 实测校正（2026-09-20）：上面这段里的"**写链路没有拿到浏览器提交的基准——antd 的日期区间选择器无法用 `fill` 驱动，UI 填表没走通**"已经过期。同一批并行工作（下面三条线的 A 行）找到了根因：**rc-picker 在 `showTime` 模式下把输入框设为 `input.readOnly = true`**，所以 `fill` / 原生 setter / `press` 全都不可能生效，只能点面板。按这个配方抓到了浏览器真实的 `create` 请求，**实测与 SDK 发出的零差异**。所以"两种证据强度不同、不要混为一谈"这个提醒**现在不再适用于写链路**——它已经与读链路同级（`docs/roadmap.json` 的「浏览器逐字段基准 + 回归」项）。
| 逐字段基准回归 | **已建立**（提交 `64f9283`）。基准用 bsk 在测试环境会议室页点「查询」时抓取，**脱敏在页面内完成、token 从未离开浏览器**；测试断言 SDK 发出的 URL（含 query 键顺序）、method、请求头与基准一致。30 个用例全绿，并做过反证（去掉默认参数即变红） |

> **基准回归当场就抓出了一个真实差异**：浏览器发的是 `order=&orderField=&name=&pageNo=1&pageSize=20&_t=…`，而 SDK 原始实现只发 `pageNo/pageSize`——**少了两项 renren 列表页默认参数，且参数顺序也不对**。这验证了 D20 的价值：不做逐字段比对，这类差异根本看不出来，而它意味着"能力签名"与真实页面不等价。
> 由此得出一条通用结论：**renren 列表页的默认查询参数（`order`/`orderField`，空值也发）是逐页推进时必须复刻的一部分**，不是可省略的噪音。
| 测试环境地址 | 已实测确认：`https://webtest01.wodecorp.cn/portal.html#/` 的后端是 **`https://biz-api-test.wodecorp.cn`**（即 `.env.build.test` 那一套）。该页确实调用了 `/admin-api/hr/meeting-room/page`，与 SDK 实现一致；页面上也能取到 `build.json`（版本标记） |
| 真实环境冒烟 | **已跑通**（2026-09-20）。对 `https://biz-api-test.wodecorp.cn` 读取会议室列表成功，返回 8 条（山东会议室 / 设计中心会议室 / 河北会议室 / 天津会议室 / 禁用会议室 …）。**SDK 能真的读到 Portal 数据这个根本假设，成立。** |

> 冒烟同时**验证了 D34 的判断**：`/dashboard/meeting-room/list` 在规则表里确实算不出 module-type，SDK 按约定不发这个头，请求照样成功——说明"算不出就不发、与浏览器一致"这条是可行的，不是猜测。
| 写能力 | ~~未做。要从该页面的四件套产出之后再加（D26）~~ → **2026-09-20 回填：已做。** 写链路端到端验证（见上面「写链路」行），且 `prepare` / `submit` / `cancel` 已作为能力登记进目录、闭合到 `-llm` 链路（见下面三条线表的 B 行与 `docs/roadmap.json`） |

### 阶段① 当前推进的三条线（2026-09-20，并行）

| 线 | 目标 | 结果 |
| --- | --- | --- |
| A 浏览器写基准 | 补上写链路的浏览器逐字段基准 | **完成**。找到了此前所有填表尝试都失效的根因——**rc-picker 在 `showTime` 模式下把输入框设为 `input.readOnly = true`**，所以 `fill` / 原生 setter / `press` 全都不可能生效，只能点面板。按此抓到浏览器真实的 `create` 请求，**实测与 SDK 发出的没有差异**（URL、方法、body 含键顺序、请求头键集合全部一致）。写链路现在与读链路同级 |
| B 能力目录与检索 | 落实 D8/D11/D14/D24 | **完成**。分层下钻（域 → 页面 → 能力）、检索、基于别名表的路由推荐、以及 D14 的 `-llm` 协议（怎么调 / 参数契约 / 返回形状 / **数据里哪个字段对应哪个下游能力**）。链路已闭合到写能力：`recommend → usage → definition → prepare → submit → cancel` |
| C 会话与基础数据缓存 | 落实 A3/H5 | **完成**。会话键 `(用户, 租户, 语言)`；绝对 30 分钟 + 空闲 30 分钟取先到；**两层单飞**（会话级 + 能力级，缺一层会被并发放大）；照 `BASE_DATA_REGISTRY` 的按需加载与依赖拓扑；LRU + 事件出口；三种粒度的主动失效 |

三条线合计新增约 4,200 行源码与 1,900 行测试。统一接线后：**typecheck 退出码 0，141 个用例 / 10 个文件全绿，构建正常**（提交 `2958b54`）。

> ⚠️ 实测校正（2026-09-20）：B 线那一行的"`-llm` 协议（**怎么调** / 参数契约 / 返回形状 / 数据里哪个字段对应哪个下游能力）"写在当时是**高估**的。黑盒评测（`docs/eval-report.md`）实测：
> - **"怎么调"当时根本没落地**：`describe()` 不返回任何执行绑定，能力 id 在整个目录输出里没有一处映射到方法名（G1，判为**阻断**）。
> - **"哪个字段对应哪个下游能力"也没接上**：`consumption` 写"用 `lookup` 指定的能力查候选"，但 `lookup` 字段不存在（G2，同样判为阻断，见 H35）。
>
> 两条**现在都已修**（`src/capabilities/invoke.ts`、`src/catalog/describe.ts`、`src/catalog/links.ts`），但注意 `docs/eval-model-report.md` 的 N2：**G1 至今没有被真实模型验证过**——那轮评测的答案契约里 `capabilityId` 直接就是句柄，模型不需要写出"怎么发出去"，所以它的通过**不能**读成 G1 已解决。要测 G1，答案契约必须要求给出一次可执行的调用（方法路径 + 完整参数）。

### 接线时定下的一件架构事：一个 axios 实例 = 一个用户的一个租户

C 线查出来的：`createPortalHttp(config)` 的凭据与语言是**创建时绑定**的——请求拦截器闭包读的就是那份 `config`（`src/http/client.ts`），没法靠给单次请求传参换人。

所以 SDK 有两个入口：

| 入口 | 形态 | 适用 |
| --- | --- | --- |
| `createPortalHeadless(config)` | 凭据绑在实例上，**一个进程服务一个 Portal 用户** | CLI、冒烟脚本、单账号任务 |
| `createPortalServer({ baseUrl })` | 按会话取凭据，**一个进程服务多用户 + 多租户** | SY 服务端要用的形态（A2） |

多用户形态落成「**一份会话一份请求函数**」。这是有意的取舍：一份凭据一个实例，请求头天然不会串用户；代价是每会话一个 axios 实例（实例本身很轻，重的是它加载的那份基础数据）。

> 这条直接回答了 A2 的一个隐含前提：「用户携带自身 SY ID 以及 Portal Token 请求 SY 服务端」意味着**服务端要同时服务很多用户**，而当前 `src/http` 的形状天然只支持单用户。如果将来实例数成为问题，改动点是让拦截器从 `requestConfig.credential ?? config.credential` 取凭据——那是后续可以再决定的优化，不是现在的阻塞。

### 第二轮三条线（2026-09-20，并行推进中）

| 线 | 问题 | 取证方式 | 归属文件 |
| --- | --- | --- | --- |
| D 写操作 → 缓存失效映射 | D4 全放开写之后，哪次写该失效哪些基础数据，现在没人知道 | **前端代码证据为主**（找 `softFetch*` / `clearDictCache` / 写后重取的调用点），必要时用 bsk 做只读观察 | `src/invalidation/**`、`test/invalidation.test.ts` |
| E 目录可见性过滤 | D8 说下发的应是"当前用户可见的菜单"，而目录现在还是全量 1019 行；F18 已查到后端 `/sys/menu/nav` 现成 | **必须去浏览器拿真实响应**，并且要量"菜单树路径 vs 清单 `menuPath` 的真实匹配率" | `src/catalog/visibility.ts`、`test/visibility.test.ts`、`baseline/menu-nav.sample.json` |
| F 别名表维护成本 | `aliases.ts` 是人工维护的，会随页面数膨胀 | **代码与数据**：量出多少可自动推导、多少必须人工 | `tools/generate/derive-aliases.mjs`、`src/catalog/aliases.derived.ts`、`test/aliases-derived.test.ts` |

三条线都**不碰** `src/index.ts`，也不许跑 git 写命令、不许从页面提取凭据（E 线只读 `/sys/menu/nav` 的**响应体**是允许的，但不许 dump 请求头）。接线与提交由主会话统一做。

> 对 E 线特别说明：菜单树路径与清单 `menuPath` 的匹配率是这一线最有价值的产出——它决定了"按菜单过滤"这条路到底走不走得通。如果匹配率低，结论就该是"要另找可见性来源"，而不是硬凑。

> ✅ **三条线的结果（2026-09-20 回填）：全部 done。** D → `src/invalidation/*`（23 条规则，10 确定 + 13 推测，每条带 `文件:行号`）；E → `src/catalog/visibility.ts` + 基线 `baseline/menu-nav.sample.json`；F → `tools/generate/derive-aliases.mjs`（801 条候选，覆盖 93.3% 菜单页）。逐条证据见 `docs/roadmap.json` 阶段①。
>
> **E 线那条"特别说明"的答案是：`menuPath` 匹配这条路走不通，换了一个连接键。** 实测：菜单节点的 `url` **恒为 null**，页面路径实际在 `permissions` 字段里，而且**从不是逗号分隔**（2,848 个节点里逗号出现 0 次，与 DTO 注释不符）。所以连接键改成「目录 `permission` ↔ 菜单 `permissions`」，不是"路径 ↔ 路径"。出处：`docs/conventions.md` 第 16 条、`baseline/menu-nav.sample.json`。
> 另外 E 线还得出一个**与 D8 的直觉相反**的结论：**菜单树不是权限裁决**——某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，但该能力是可调的。拿菜单树预判 403 会把能用的能力藏起来，它的定位只能是"下发面收敛"（`docs/conventions.md` 第 15 条）。

**D 线的中期发现（值得单独记）**

1. **前端"写后重取基础数据"的地方本来就极少**——找到的直接证据只有字典（3 处）和安全配置（1 个页面 4 个入口）；租户相关的是上下文切换而非写数据。这与 H5 早先的统计一致（1,390 处 `message.success`、1,621 处列表刷新，而缓存失效只有 15 处）。
   → **推论**：这是一种**前端缺口**，不是"前端认为不需要"。写成功了只刷新本页列表、公共基础数据不动。SDK 若照抄前端行为，就会看到陈旧数据。所以映射表里必然有一部分规则**没有"观察到重取"的证据**，只能靠"写接口与基础数据同源"来推断——这类必须**单独标注为推测项**，不能与确定项混在一起。D 线是这么做的。
2. **`dict-hr` 与 `dict-platform` 是同一个接口的两个 key**（都来自 `GET /admin-api/system/dict-data/grouped-list`，`system.js:196` 与 `:315`），所以必须一起失效。
3. **我举的例子是错的**：我说"刚新增一个部门，组织树还是旧的"——**Portal 前端没有叫 `dept` 的写接口**（全仓 `system/dept` 只命中读接口）。但**组织架构的写入口是存在的**，只是命名是 `org/*`：`org/organization`、`org/hrpost/save`、`org/hrsalarylevel/save`、`hr/org/organizationProperty/save` 等。已让 D 线按这个更正重查。
4. **组织树目前不是会话缓存的六个 key 之一**：它是 `useOrganizationStore` + `fetchOrganization()`（`system.js:844`，**没有 `force` 参数**），被初始化链调用（`session.js:52`）。**要不要给它加第 7 个 key，是个待我拍板的设计决定**——已让 D 线先查清它的接口路径与响应规模。

### 第三轮三条线（2026-09-20，并行推进中）

按路线图剩下的三项推进。三项的性质不同，取证方式也不同：

| 线 | 问题 | 性质 | 归属文件 |
| --- | --- | --- | --- |
| G 写操作幂等 | D12 定了「写能力必带 `requestId`、SDK 短窗口去重」但一直没做 | 纯代码，**唯一「定了没做」的安全项** | `src/idempotency/**`、`test/idempotency.test.ts` |
| H 批量生成器 | 聚类说 463/691 的列表页可批量，**但一个都还没批量生成过** → **已跑，结论是"可批量"被高估（29%），见本节末的结果块** | **方案的成本模型压在这上面**；要给出真实正确率 | `tools/generate/batch-capabilities.mjs`、`src/capabilities/generated/**` |
| I AI 可驱动性评测 | `-llm` 协议链路在测试里闭合，**但没有被任何真实模型消费过** | **方案的第二根支柱**；且必须做**黑盒**才能测出真东西 | `tools/eval/**`、`docs/eval-report.md` |

**I 线的设计要点**：评测者只能用**真实调用方会有的信息**——`docs/usage.md` + SDK 的真实返回值，不许读 `src/`。每次"不得不读源码才能继续"的时刻都要记下来，**那就是协议的缺口**，也是这一线最有价值的产出。产出要是一个**可重复执行**的评测装置，将来批量生成的页面接进来能直接复跑。

> 为什么 G 和 H/I 分开派：G 小、独立、能单独验证；H 和 I 本来是相依的（AI 要拿批量生成的页面当测试集），但 I 可以先在**现有能力**上把评测装置建起来并跑第一轮——装置是可复用的，页面接进来之后再跑一次即可。这样两条都不闲着。

> **H 与 I 两条线的结果（2026-09-20，写上面这段时还没有）**
>
> - **H（批量生成器）**：假设**被证伪**。255 个"纯声明式"列表页实测只有 **136 个能全自动产出（53%）**，115 个需人补、4 个产不出；折算到 463 的口径是 **29%，不是 100%**。详见 §1d 的更正块（出处 `src/capabilities/generated/batch-report.json`）。G 线（幂等）同期完成并接进两个门面。
> - **I（AI 可驱动性）**：装置建成并跑了**两轮**——人工作答 `docs/eval-report.md`（5/5）与真实模型 `deepseek-flash` `docs/eval-model-report.md`（协议修前 3/5、修后 2/5）。原始问题"模型会不会用"的答案是**会**（`required`、`description`、`matches[].via/from`、`write`、`warnings`、`next[].why` 全被用上），但**协议停在决策层、没接到执行层**；真正构成阻断的只有 G2（`lookup` 缺失），已修。
> - **两件容易误读的事**：① 真实模型的分**比人低**，且修完 G2 之后失败点转成"答案契约的措辞"与"模型自己的行为习惯"，不全是协议缺口；② `docs/eval-model-report.md` §3 记录了本轮最大的方法学风险——**协议在评测进行中被并行代理改掉了**，所以那一轮的 A/B 两份数字各对应一个带"协议指纹"的版本，引用时要说清是哪一版。

### 从这三条线里新长出来的待决问题

- **会话的失效与写操作的配合**：SDK 现在有 `invalidateCapability`，但**哪些写操作该失效哪些能力**这件事还没定。D4（写操作全放开）下，一次写操作污染了字典或组织树缓存，用户可能看到陈旧数据。这需要一份"写能力 → 影响哪些基础数据"的映射。
- **能力目录的可见性过滤**：目录目前是**全量**的（1019 行）。D8 说下发的应该是"当前用户可见的菜单"，也就是要按 `permissions` 过一遍。而 F18 查到后端 `GET /sys/menu/nav` 本来就返回按用户过滤的菜单树——这条还没接。
- **路由推荐的维护成本**：`src/catalog/aliases.ts` 是**人工维护**的。D11 说推荐由 SDK 提供，那么这份表会随页面增长而膨胀。它是否该由生成器部分产出、或将来由服务端下发替换，需要定。

> ✅ **上面三条后来都做了（2026-09-20）**，原文的"还没定 / 还没接"已经过期：
> 1. **写操作 → 缓存失效映射**已落地：`src/invalidation/*`，23 条规则（10 条确定 + 13 条推测，**每条带 `文件:行号` 证据**，推测项单独标注，不与确定项混放）。依据：前端"写后重取基础数据"的调用点本来就极少（见第 2 轮的发现），所以映射表里必然有一部分没有"观察到重取"的证据。
> 2. **目录可见性过滤**已接上 F18 的 `GET /sys/menu/nav`：`src/catalog/visibility.ts`，基线 `baseline/menu-nav.sample.json`（真实菜单响应）。**但要注意它只做"下发面收敛"，不是权限裁决**——实测某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，而该能力是可调的；拿菜单树预判 403 会把能用的能力藏起来（`docs/conventions.md` 第 15 条）。
> 3. **别名表已能自动推导**：`tools/generate/derive-aliases.mjs` → `src/catalog/aliases.derived.ts`（801 条候选，覆盖 93.3% 菜单页）。人工表 `aliases.ts` 保留为补充。
>
> 逐条证据见 `docs/roadmap.json` 阶段① 的对应项。

**下一步的两个选项**（都需要你定）：

1. **跑真实环境冒烟**：需要一份 Portal 会话 token 与租户 id。可以用 `bsk` 打开已登录的 Portal 页面取凭据，也可以你手工给。
2. **继续做四件套**：为 `/dashboard/meeting-room/list` 与 `/simple/hr/form/033` 产出能力定义、参数契约、逐字段基准、操作步骤文档。

### 第 9 轮（2026-09-20）

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D31 | 批量生成后是否还逐页看真实页面 | **仍然逐页全看**（不因可批量而减量） |
| D32 | 阶段① 起始业务线 | **会议室预定** |
| D33 | 清单产出 | **先生成全量清单**（已交付，见 §1d） |

### 第 10 轮（2026-09-20）

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D34 | 42% 算不出 `module-type` 的页面 | **与浏览器保持一致**——算不出就不发这个头，接受与浏览器完全相同的数据范围（也接受那份更宽的并集范围） |
| D35 | 清单生成器脚本的归属 | **放进 SDK 包自己的仓库/目录**，作为包的一部分（与 D18 的"独立包"一致，发版后能一键重跑） |
| D36 | 下一步 | **从会议室开始跑通**整条链（AI 看真实页面 → 四件套 → 逐字段基准 → 回归） |

---

## 1d. 阶段① 模板聚类与清单（实测，2026-09-20）

方法：从 `app/portal/menus/**/*.js` 抽出全部菜单叶子路径（去重、排除生成式 iframe），按路由合法化规则（`hr/`、`education/`、`common/` 三层被去掉）反查 `views/` 下的路由文件，再按文件内容归类。**纯只读统计，脚本在 `/tmp`，未改动仓库。**

### 解析率

| 项 | 数 |
| --- | --- |
| 菜单叶子路径（去重后） | **981** |
| 能解析到路由文件 | **972（99.1%）** |
| 解析不到（需人工确认） | 9 |

解析不到的 9 条：`/dashboard/certificate/contractType/list`、`/dashboard/certificate/intellectual-property/list`、`/dashboard/finance/investment/daily/interval-report/list`、`/dashboard/platform/setting/{menu,office,role,user}/list`、`/dashboard/platform/system/log/platform/list`、`/dashboard/sale/shop/info/page/shop/details`。

### 按框架分类

| 分类 | 数量 | 其中含写操作 |
| --- | --- | --- |
| 列表页（自定义 `customLoad`） | **436** | 247 |
| 其他 / 自定义页面 | **277** | 13 |
| 列表页（声明式 `getDataListURL`） | **255** | 103 |
| 表单页 | 3 | 2 |
| 声明式流程表单（`views/simple`） | 1 | 0 |
| **合计** | **972** | **365** |

> **列表页共 691 个，占 71%**；含写操作的页面 365 个（38%）。
> 注意：分类是按**文件级**判定的——一个文件里同时有列表和弹窗表单时只算主类型，所以"含写操作"是下界。

### 关键结论：可批量的上限比预想的高

把 691 个列表页按 `customLoad` 函数体量再切一刀：

| 规模 | 数量 | 能否批量生成 |
| --- | --- | --- |
| 无 `customLoad`（纯声明式） | **255** | ✅ 完全可批量 |
| `customLoad` < 10 行 | **208** | ✅ 近乎可批量（只是参数改名/拼接） |
| `customLoad` 10–30 行 | 100 | ⚠️ 半自动，需要人过一遍 |
| `customLoad` 30–80 行 | 49 | ❌ 逐页 |
| `customLoad` > 80 行 | 79 | ❌ 逐页 |

> ⚠️ **下面这段的最后两句已被证伪，先读紧跟其后的更正块再引用本段任何数字。** 保留原文是为了记录当时的判断过程。

**463 / 691（67%）的列表页是"纯声明式或接近声明式"。** 也就是说大部分列表页的能力定义和参数契约可以由生成器批量产出，人只需要抽检。这把我原先"928 个页面逐个人工推进"的悲观估计推翻了一大半。

> ### ⚠️ 2026-09-20 实测更正：上面这个"463 可批量"是**高估**的
>
> 批量生成器写出来、跑过、并用浏览器抽验了 7 个页面之后（`tools/generate/batch-capabilities.mjs`、`src/capabilities/generated/batch-report.json`），真实的数字是：
>
> | 口径 | 完全自动 | 需人补 | 产不出 |
> | --- | --- | --- | --- |
> | 20 个抽样 | 10 | 9 | 1 |
> | **全部 255 个"纯声明式"列表页** | **136（53%）** | **115（45%）** | **4（1.6%）** |
>
> 也就是说：**即便把 208 个短 `customLoad` 也算成可批量，136/463 = 29%，不是 100%。**
>
> **本节的聚类口径有方法论问题。** 它按 `customLoad` 的函数体行数分类，但"这个页面能不能自动产出"实际取决于四件互不相干的事：**URL 形态**、**请求走哪个 http 实例**、**form 是否静态**、以及**有没有 `convertFetchForm` 这类不被 `customLoad` 统计覆盖的钩子**。
>
> 最后一条影响最大：**约 28% 的"纯声明式"页面调了 `convertFetchForm`**，它会改写请求参数，于是参数契约与 form 字段**不一致**——这些页面在上一版的表里显示为"完全可批量 ✅"。（比例由两条独立路径核实：生成器报 72/255，另用不同文件范围独立重数得 77/280。）
>
> "需人补"的 115 个还要再分，代价差很多：`contract` 73（要读一段函数重写参数）、`defaults` 25（只需补一个默认值表达式）、`base` 16（请求打到另一个前缀）。
>
> **如果重来一次，口径应该换成「请求契约能不能静态确定」，分母用 691，而不是按 `customLoad` 行数分档。**
>
> **另一条实测教训**：静态推导**一定会错**，而且错的地方只有浏览器能发现。生成器自己就错了三处——① 把 platform.js 的 `/admin-api` 补前缀规则无条件套到了 `sale.js` 上（后者没有这个拦截器，真实请求是 `/admin-shop-api/...`）；② 分页参数名 `pageSize` / `limit` 取决于走哪个实例；③ `useListPageModule({ http })` 是**简写属性**，第一版正则只认 `http:`，把真正传了 http 的 34 个页面全判成了"走全局默认"——那 34 页的 baseURL、补前缀规则、分页名**三项全错**。所以 `auto` 的能力也**必须抽样做浏览器基准**，不能免检。
>
> **一个悬着的范围问题**：16 页（占 255 的 6%）的请求打到 `VITE_SHOP_ADMIN_API`（`/admin-shop-api` 前缀，与主后端**同 host 不同前缀**）。D3 定的是"只做 Portal 主后端（`VITE_ZHDJ_PLATFORM_API` → `/admin-api`）"，按这个口径它们出范围；但它们在菜单里确实是 Portal 页面。**要不要支持第二个前缀，需要你定。**

### 277 个"其他/自定义页面"里有什么

目录分布（前几名）：`product/layer` 30、`product/chicken` 25、`product/hatchery-saas` 24、`finance/depreciation` 15、`platform/report` 13、`platform/trade` 13。

**一个明显的结构性发现**：`finance/depreciation` 下的 15 个页面是**矩阵式重复**——`biological / fixed / intangible / long-term / usage` × `death / sale / adjustment / allocation / property`，路径规律完全一致，属于"一次建模、批量生成"的典型。

其余多为产品/孵化类页面，以及少量仪表盘、详情展示类。240 个文件用简单特征（Tabs / 图表 / 表格 / 表单 / 弹窗）都没匹配上，**大概率是薄路由壳（只 import 组件）**，需要再往下一层看。

### 对阶段① 的直接影响

建议的推进顺序改为：

1. **先批量**：255 个纯声明式列表页 + 208 个短 `customLoad` 列表页 → 生成器一次产出，人工抽检
2. **再矩阵**：识别 `finance/depreciation` 这类矩阵式重复页，参数化生成
3. **最后人工**：128 个重 `customLoad` 列表页 + 277 个自定义页 + 9 条解析不到的，逐个走"AI 看真实页面"的四件套

> 这个顺序下，**真正需要逐页投入的是约 400 个页面，而不是 928 个**。但 D25 说"所有页面都走 AI 看真实页面"——批量生成后，逐页看真实页面的价值主要在**验证**而不是**发现**。**已决策（D31）：仍然逐页全看**，所以上面的顺序优化的是"生成"，不是"验证"。

> ⚠️ 实测校正（2026-09-20）：
>
> 1. **"约 400 个页面"这个数不可再引用。** 它建立在"463 可批量"之上，而那个比例已被证伪（见上一节的更正块）：255 个纯声明式里只有 136 个能全自动，**"需人补"的 115 个仍需人过一遍**，208 个短 `customLoad` 页也不再是"近乎可批量"。真正的量级比 400 大得多，具体数取决于"需人补"折算成多少人工——**这一点还没量过，属于未复核**。
> 2. **第 1 条"生成器一次产出，人工抽检"里的"抽检"不是可选项，是必须项。** 实测：静态推导一定会错，浏览器抽验 7 页才把生成器的三处系统性错误抓出来（§1d 更正块）。出处 `src/capabilities/generated/batch-report.json` 的「浏览器实测核对」段（7/7 一致，但那是修完之后的结果）。
> 3. **第 2 条"矩阵式重复页"仍未验证**：`finance/depreciation` 那 15 页的规律是从路径看出来的，**没有人真的参数化生成过它们**。属未复核。
>
> **另一处口径差（未复核）**：本节「按框架分类」表的合计是 **972**，而已交付的 `generated/page-catalog.json` 是 **1,019**（把 49 条 iframe 叶子算进来了，因此两者本就不该相等）；但把 iframe 减掉后仍差 2 条，"其他/自定义页面"一项也从 **277** 变成 **266**。两个数是两套脚本、两个范围跑出来的，**差在哪里没有对过账**，引用时注意分母不是同一个。

### 已交付：页面唯一参考清单

| 文件 | 内容 |
| --- | --- |
| `页面清单.json` | 1,019 行，机器可读，含 `no / id / 菜单路径 / 页面名 / 业务域 / moduleType / moduleTypeLabel / 权限码 / 路由文件 / 分类 / 含写操作 / 菜单来源 / 状态 / 优先级` |
| `页面清单.md` | 同一份数据的可读表格版，`状态` 列全部为"待处理"，可直接当待办列表勾 |

生成器脚本在 `/tmp/portal-checklist.js`（只读仓库，产物写到本目录）。

**行数与覆盖**（与 §1d 的 972 有差异，因为本脚本把菜单里 function 生成的 iframe 也算进来了）：

| 项 | 数 |
| --- | --- |
| 总行数 | **1,019**（含 49 条 iframe 叶子） |
| 无页面名 | 3 |
| 无权限码 | 34 |
| 未解析到路由文件 | 9 |
| 含写操作 | 365 |

「会议室预定」相关的第一条在**第 228 行**（`/dashboard/meeting-room/list`，声明式列表页，含写操作），正好离起点很近。

### 新发现：42% 的页面在浏览器里本来就算不出 `module-type`

清单里 **427 / 1,019（42%）** 的行匹配不到 `all_menus_type_match` 的任何规则。未匹配的分布：

| 业务域 | 未匹配数 | 说明 |
| --- | --- | --- |
| `platform` | **241** | `SYSTEM_MODULE_TYPE_PLATFORM` 这个常量存在（值 101），但 **`all_menus_type_match` 里根本没有对应规则** —— 整个平台管理域 100% 无匹配 |
| (iframe) | 49 | 不适用 |
| `product` | 47 | 部分子路径不在规则前缀内 |
| `finance` | 28 | 同上 |
| `setting` / `toolbox` / `flow` / `supply` | 49 | 同上 |

**为什么重要**：`getCurrentModuleType()` 匹配不到时返回 `undefined`，`generateHttpHeaders` 就**不发 `module-type` 头**。结合 F19（后端不传该头 = 数据范围取该用户所有模块的并集），结论是：

> **Portal 自己在这些页面上，本来就是以"全部模块数据权限的并集"在取数的。** 这不是无头引入的问题，是既有行为。

所以 F19 的实践含义要修正：**"必须传对 `module-type`"只适用于那 58% 能算出值的页面**；剩下 42% 的页面，要"遵守浏览器的逻辑"就意味着**同样不发这个头**——也就同样继承那个更宽的数据范围。要么接受与浏览器一致，要么把规则的缺口补上（那是 Portal 侧的改动）。

> **已决策（D34，2026-09-20 回填）：选"接受与浏览器一致"** ——算不出就不发，接受那份更宽的并集。落地形态是 `resolveModuleType()` 返回 `{ moduleType: null, matchedBy: 'none' }`，请求照发、不发这个头（`src/context/module-type.ts:91`）。所以本文其他章节里"`module-type` 必须传"的说法，**一律只对那 58% 成立**。
>
> 顺带一条复核（2026-09-20）：评测报告曾标记 `工资找齐`（`/dashboard/hr/salary/adjust/list`）的 `moduleTypeLabel` 是「绩效管理」、疑似推导错误（`docs/eval-report.md` §3⑨/§8.4）。**已核对：不是错。** Portal 自己的 `all_menus_type_match` 就把 `/dashboard/salary/adjust/`（注释写着"工资找齐"）列在 **type 13「绩效管理」** 下（`app/portal/menus/index.js:206`，常量见 `app/portal/utils/define.js:162`）。生成器的 27 条规则是这张表的前缀复刻（`generated/module-type-rules.json`），这一条上忠实。

---

### 由 D1/D2/D4 直接产生的新必答项

---

### 由 D1/D2/D4 直接产生的新必答项

**§3.5 —— 这三条决策叠加后，下面几件事从"建议"变成"必须"，否则会有真空**

1. **审计与归因**（原 H12）。会话 token 在 Portal 侧看起来和用户本人完全一样。全放开写操作后，一旦出问题，**无法回答"这条是谁做的"**，也无法单独掐断"AI 发起的写入"。建议：SDK 统一带一个来源标识头；这需要 Portal 后端配合记录，属于跨团队事项。
2. **幂等**（原 H11）。全放开写操作后，AI 重试 = 重复下单/重复提交。现在全仓没有任何幂等键。这条不解决，重试就是数据事故。**（2026-09-20 回填：已做——D12 落地为 `src/idempotency/*`，键是 `namespace|租户|用户|能力|目标|requestId`，已接进单用户与多用户两个门面；47 个用例 + 5 组反证。注意它的边界：**它不是幂等**，进程重启 / 多实例 / TTL 过后都不生效，真正的幂等仍要在服务端做。见 H11 与 `src/idempotency/README.md`。）**
3. **误操作的可逆性清单**。既然不设人工闸门，至少要有一份"哪些操作不可逆"的清单（删除、审批决定、批量导入、凭证生成、权限变更），并明确这些是否接受由 AI 直接触发。
4. **凭据的失效面**。会话 token 无刷新流程，过期即 `logout()`；Portal 侧也无法单独吊销这一份连接。需要明确：失效时 SDK 的行为、以及用户如何主动断开（H6/Q15–Q17）。
5. **单次写操作的爆炸半径**。全放开下，"AI 误解意图"和"AI 正确执行"走的是同一条路。建议至少保留一层**执行前回执**（把要提交的 payload 返回给调用方/SY，让调用方能拦），成本很低。

---

## 2. 先看这几条代码事实（会改写部分设计）

**F1｜Portal 已经有一套给外部程序用的凭据，叫「私人令牌」。** 位于「个人设置 → 私人令牌」，接口 `/admin-api/system/personalToken/{create,update,regenerate,delete,getByPage,scopeList}`，字段有 `description`、`scopeGroups`（权限分组）、`expireTime`（空=永不过期）、`tokenPrefix`、`lastUsedTime`；新建/重生成/删除都要**再输一次登录密码**，token **只展示一次**。设计文档：`docs/superpowers/specs/2026-05-27-personal-token-settings-design.md`。**[代码]**

> 这正是"给外部程序长期使用"的凭据形态（Gitee 私人令牌）。而 A4 拿的是**浏览器会话 token**：全量权限、无 scope、无"这是谁在用"的标识、无独立吊销入口、无最近使用记录。A1/A2/A3/A4 通篇没有提到它。

**F2｜Portal 已经有一套「开放接口」注册表，而且是专门写给 LLM 的。** `/admin-api/system/openApiRegistry/*`，字段 `name / apiPath / httpMethod / scopeKey / groupName / description / enabled / status / params(树形，分 Headers-Path-Params-Body) / responseExample`，带 `scanByUrl` 自动扫描导入；`buildOpenApiRegistryMarkdown()`（`app/portal/views/dashboard/platform/intelligence/prompt/interface/markdown.js`）生成的就是"写给 LLM 调用"的文档，用户在「个人设置 → Open API」能看到自己被授权的那部分并一键复制 Markdown。**[代码]**

> A6 的 `{页面名}-list-llm` 和 `llm` 字段，和它做的事高度重叠。而且它挂在一个更大的"人工智能 / 提示工程"模块下（接口 / 提示词 / 意图 / 业务事件 / 模板 / 类型 / 知识库 / 交互），提示词通过 `openApiRegistryId` 绑定接口，也就是说 **Portal 内部已经有一套"Prompt + 工具(接口)"的编排模型**。

**F3｜无头环境没有 URL，但每个请求都必须带 `module-type`，而它原本是从 URL 推出来的。** `generateHttpHeaders()`（`app/portal/utils/system.js:813-836`）注入 `tenant-id`、`token`、`module-type`、`Accept-Language`；`module-type` 由 `getCurrentModuleType()` 计算（`app/portal/menus/index.js:533-545`），内部读 `window.location.href`，用约 330 行的 `all_menus_type_match`（`menus/index.js:176-508`）按路径前缀映射成"系统模块号"（`utils/define.js:161-215`，11/12/…/101）。**[代码]**

> 好消息：请求层**已经留了口子** —— `platform.js:25` 是 `generateHttpHeaders({ moduleType: config.moduleType })`，全仓有 55 处显式传 `moduleType`（如 `SYSTEM_MODULE_TYPE_SALE.value`）。所以"显式声明这次调用属于哪个模块"是**已有约定**，无头只是把它从可选变成必需。
> 坏消息：同一个接口在不同页面被调用时会带不同的 `module-type`，后端可能据此返回不同结果。

**F3b｜Portal 自己给出了"页面"的规范身份。** `syncMenuContext(path)`（`app/portal/utils/router/menu.js:4-22`）会把当前路由归并成**菜单路径**：`/list` 保持不变，路径里出现 `create / edit / data / detail / change / step1 / step2 / step3` 时截断并补回 `list`。例如 `/dashboard/hr/staff/personal-info/detail/123` → `/dashboard/hr/staff/personal-info/list`。这个归并后的路径写进 cookie，`module-type` 就是拿它去 `all_menus_type_match` 里匹配的。**[代码]**

> 也就是说：**Portal 内部的"页面"= 归并后的菜单 list 路径**。它同时能推出 `module-type`、能对上菜单里的 `title` 和 `permission`、能对上权限码 —— 一个坐标四件事。这比"从 .vue 文件里扫出接口"可靠得多。
> 所以：**无头 SDK 的最小调度单位是"菜单页面"，不是裸接口**。你的 A6 直觉是对的，但 A2/A3/A5 描述缓存和调用时又是按"接口"讲的，两处不自洽。

**F4｜一次"会话"是 18 个 store + 十几次初始化请求，并且强绑租户。** `logout()` 要重置 18 个 store（`system.js:507-560`）；进入页面时 `runLegacyFullInitTasks()` 先串行 4 步（用户信息、销售用户、企业列表、企业开通系统），再并发 10 个请求（权限、敏感词、两套字典、安全配置、组织、销售状态、商城三套数据），其中 `fetchUserInfo` 自身还要拆成 2 个请求（`app/portal/utils/router/session.js:35-59`、`system.js:502-505`）。租户是 cookie（`system.js:571-590`），`fetchTenantSystem` 的缓存键显式是 `loadedTenantId`（`system.js:662-681`），`fetchTenantList` 分页 `pageSize=200, maxPages=100`（`system.js:593-635`）——**一个用户可能属于多个租户**。**[代码]**

> A3 说缓存键是"SY 用户下的 Token"。代码事实要求至少是 **(SY 用户, 凭据, tenantId, Accept-Language)**。多租户用户切换租户时，权限、字典、开通系统全都要重取。

**F5｜没有 token 续期，过期即死；写操作的安全门全在 UI 里。** 全仓 `refreshMark` 只做多标签页同步（`system.js:53-69`），不是续期；响应拦截器遇到 `401 / 10001 / 1002015001` 直接 `logout()` 并 `router.replace('/login')`（`platform.js:116-119`）。写入侧：`Modal.confirm` 153 处，`formRef.validate()` 几百个文件，且**提交值经常由页面内的业务规则现算**（例：`app/portal/views/simple/supply/form/006/page/pc/edit/index.vue:1466-1472` 的 `getSubmitStatus()` 按 `purchaseType / internalPurchaseType / purchaseMethod` 决定提交 2 还是 8）。**[代码]**

> 无头 SDK 没有登录页可跳，也没有弹窗可弹。A5 说"可执行用户侧全部 Portal 操作"，但**"谁点了那个确认按钮"这个问题在无头下没有答案**。

---

## 2b. 后端查证结果（打开后端仓库之后）

后端仓库（**本节结论形成时**）：`Mall_Platform_Java_Dev`（`dev` 分支），HEAD `11b844b270`。
下面 F6 起各条的行号都读自这份检出，**未**在新检出上复核。

后端仓库（**2026-09-22 起的来源声明**）：`CodeReview_Mall_Platform_Java`，分支 `test/test`，HEAD `516bf00ff5f`。

**F6｜私人令牌是一张"必须人工登记的窄名单"，不是万能钥匙——这条同时证明了 D1 是对的、我第一轮的建议是错的。**
- 私人令牌走 **`access_token` 请求头**，和会话 token 的 `Authorization` / `token` 完全是两个通道（`erp-framework/erp-spring-boot-starter-security/.../filter/TokenAuthenticationFilter.java:122-129`）。
- 校验在 `PersonalTokenApiImpl.authenticate`（`erp-module-system-biz/.../api/personaltoken/PersonalTokenApiImpl.java:39-97`）：按 `token_hash` 找到令牌 → 把 `scopeGroups` 展开成 `scopeKeys` → **再拿"请求路径 + HTTP 方法"去 `system_open_api` 表查这条接口有没有登记过**（`OpenApiServiceImpl.getRequiredScopeKey:183-199`）→ 没登记就返回 null → 用户拿到 **401**。
- 所以：**私人令牌只能调"开放接口"注册表里 `status=1` 的那些接口，未登记的一律 401，跟用户自己的角色权限无关。**
- `scopeKey` 不是人工填的，是从目标接口的 `@PreAuthorize("@ss.hasPermission('xxx:yyy')")` 里正则扒出来的（`OpenApiController.java:203-216`、正则 `:454`）；`groupName` 取自类上的 `@Tag`。**[代码]**

> **结论**：我第一轮建议"以私人令牌打底"是错的。照我的建议做，D2（全部页面）**根本不可能实现**——私人令牌是一张要靠人工逐条登记的名单。**你选会话 token 是唯一能支撑"全部页面"的选择。** H1 的问题 Q1/Q2/Q3 到此全部作废。

**F7｜会话 token 才是全量权限，而且本来就支持放在 URL 里。**
- 会话通道接受 `Authorization` 头、`token` 头、**或 `token` 查询参数**，`Bearer ` 前缀会被剥掉（`TokenAuthenticationFilter.java:169-174`、`SecurityFrameworkUtils.java:47-63`）。
- 它会加载完整的 `LoginUser`：roles、roleIdList、gradeIdList、roleModuleList、responsibleOrgIdList（`TokenAuthenticationFilter.java:184-189`、`:208-229`）。**用户本人能做什么，它就有什么** —— 这正是 D2 需要的语义。
- 顺带：`token` 能走 query 这一条，也让 H19/Q50 的"回调 URL 里带 token"有后端依据（虽然安全性顾虑仍在）。**[代码]**

**F8｜错误码比前端以为的要少。** 后端只产出 `401 账号未登录`、`403 没有该操作权限`、`1_002_015_001 租户已被禁用`（前端看到的就是 `1002015001`）。前端里 `[401, 6001]` / `10001` 里的 **`6001` 和 `10001` 在后端根本不存在**（`6001` 只是 CRM 的一个消息类型，`10001` 是个没接进全局异常处理的遗留常量）。**[代码]**

> 对 H29（失败语义）的影响：**可用的失败信号其实只有三个**，`llm` 字段想表达"可重试/要换参数/告诉用户"，后端现在给不出区分度——所有令牌类失败都塌缩成同一个 `401 账号未登录`（过期、未登记、无 scope、令牌不存在，四种原因同一个码）。要做 H29 必须先让后端区分这些原因。

**F9｜租户可以省略，但"用户可见什么"必须运行时算。**
- `/admin-api/**` 上若缺 `tenant-id`，后端会从登录用户回填（`TenantSecurityWebFilter.java:98-100`）；但带了一个与该用户不一致的租户 → **403 您无权访问该租户的数据**。所以 SDK **可以不带 `tenant-id`，但绝不能带错**。
- 结合 D13：**目录结构可以烘死，但"这个用户可见哪些菜单、可发起哪些流程、哪些字典项"是运行时数据**，只能实时取。最终形态必然是"**静态结构 + 运行时可见性**"的混合——这和 D13 不冲突，但分界要写清楚。

**F10｜幂等：后端有一个"现成但没人用"的框架，和 BPM 里一个真正在用的先例。**
- `@Idempotent` 注解和整套 Redis 实现在仓库里（`erp-spring-boot-starter-protection/.../idempotent/`，含切面与 key 解析器），但**全仓零使用**。
- `@RepeatSubmitLimit` 注解被约 17 个 controller 标注（`erp-module-fm/.../common/annotation/RepeatSubmitLimit.java`），但**没有任何处理器读它——是个空注解**。也就是说那些接口"以为"自己有防重保护，实际没有。
- **真正在用的是 BPM 的 `client_request_id`**：唯一索引 `uk_bpm_follow_up_request (tenant_id, process_instance_id, creator, client_request_id)`（`erp-module-bpm/db/2026-07-22-流程跟进与短信提醒.sql:17-18`），VO 字段写明"客户端请求编号，用于幂等"（`BpmProcessFollowUpCreateReqVO.java:29-32`）。**[代码]**

> 对 D12 的意义：**BPM 已经有一个客户端幂等键的范式可以照抄**，不必从零设计。SDK 侧短窗口去重 + 推动后端按这个范式补，两条路都有依据。

**F11｜另有一条完全独立的合作方通道，与无头无关，但值得知道它存在。**
`erp-module-openapi` 的 `/open-api/**` 走 appKey + 时间戳 + nonce + HMAC-SHA256 签名，有 5 分钟时间窗、nonce 防重放、秒级与日级限流、调用日志（含 IP/UA/耗时/错误码）。它与私人令牌通道**零交集**（不同命名空间、不同凭据、不查 `system_open_api`、不产生 `LoginUser`），且只暴露 4 个诊断类接口。**[代码]**

> 如果将来要给 SY 服务端一条"真正的机器对机器"通道，这是现成的模板——但对 Portal Headless 的 D1（用户身份代理）不适用，因为这条通道没有用户身份。

**F12｜BPM 的"接口"就在 Portal 主后端里，在外部的是流程设计器 UI——这条纠正了我 H3 的判断。**
- `platform.js` 会给任何不以 `/admin-api` 开头的路径补前缀，所以 `/bpm/process-definition/create-list` 实际打到 `https://biz-api.wodecorp.cn/admin-api/bpm/process-definition/create-list`——**和普通 Portal 接口同一个 host、同一个 token、同一个后端进程**。
- iframe 里的那个流程引擎（`VITE_FLOW_ENGINE_URL` = processdev / processtest / process.wodecorp.cn）是**另一个 SPA**（`Process_JS` 仓库），但它自己也调**同一个后端**：`Process_JS/.env.prod:7,15` → `VITE_BASE_URL='https://biz-api.wodecorp.cn'`、`VITE_API_URL=/admin-api`。
- → **D3 排除的是 iframe 里的流程编辑器 UI，不是 BPM 接口。D9 依赖 `create-list` 因此与 D3 不冲突。** H3 的结论要改。

**F13｜"当前用户可发起哪些流程"，后端已经按权限过滤了，而且有一份写死的表单白名单。**
- `BpmProcessDefinitionStartListService.java:44-53, 65-91`：取 `getPermissionsNotBySystem()`，把 `formCustomCreatePath` 归一化成 `simple/...` 后判定——
  - 白名单永远可见：`simple/hr/form/045,035,034,032,041,042,043,033,025`（**033 正是会议室预定**）；
  - 其余 `simple/...` 需用户持有 `/flow/form/<去掉 simple/ 的路径>`；
  - 其他一律可见。
- → 我上一轮说"112 个流程表单没有中央注册表"**只在前端成立**；**后端有一份 9 个 ID 的白名单**（写死在代码里）。能力可见性这件事后端已经在做了。**[代码]**

**F14｜"要不要选审批人、选几个"完全由 BPMN 模型决定，且服务端强校验。**
- `validateStartUserSelectAssignees`（`BpmProcessInstanceServiceImpl.java:1103-1142`）沿 BPMN 从开始事件走，只看 `START_USER_SELECT` 策略的节点：**没有这种节点就直接放行**（`startUserSelectAssignees` 确实可选）；有的话逐个校验非空、id 非空、不重复、符合节点 min/max、用户存在，错误码 `1_009_004_003`–`_007`。
- 判定依据是 **BPMN 扩展属性**（建模时定的），不是配置表、不是规则引擎。**服务端没有任何默认或自动选人。**
- **SDK 可以自己算，不必依赖业务模块那 ~20 个 wrapper**：`GET /bpm/process-definition/get?id=` 返回模型里全部 `START_USER_SELECT` 节点；`POST /bpm/process-instance/preview` 返回每个节点的 state（缺审批人时是 `STATE_START_USER_SELECT`）。
- → 正好接上 D6：SDK 可以先问后端"这条流程要不要选人、有哪几个节点、最少/最多选几个"，再按"搜索型参数"协议问用户要关键字。

**F15｜审批动作的权限门在服务端，不在 UI——这是 D4 的天然边界。**
- `approve` / `reject` 都校验 `assignee == caller`（错误码 `1009005001`）；`withdraw` 还要求是"最后完成的任务且下一节点唯一"；`cancel-by-start-user` 要求 `startUserId == caller`。**这些是服务端强校验，AI 绕不过去。**
- → **AI 只能审批分给自己的任务**，越权审批在服务端就挡住了。"全部放开写操作"在这里不是无限制的。

**F16｜会议室的时段冲突服务端确实校验，但业务失败报的是 500。**
- `MeetingApplicationServiceImpl.validateMeetingRoomAvailable:317-331`：重叠判定 `existing.start < newEnd AND existing.end > newStart`，只看 SUBMITTED/APPROVED 且 `isUsing` 为 null 或 1 的记录；冲突时 `throw exception("该时间段会议室已被预定")`。
- `validateTime:295-311` 另要求 end > start、分钟必须是 00 或 30。
- **但 `ServiceExceptionUtil.exception(String)` 映射到 `INTERNAL_SERVER_ERROR` → code `500`**，message 原样透传——**业务冲突和服务器故障在 code 上无法区分**，只能读中文 message。**[代码]**
- → 强化 F8：H29 想让 `llm` 表达"可重试 / 换参数 / 告诉用户"，**后端现在给的信号远远不够**（业务失败 500，令牌失败 401，四种原因同一个码）。

**F17｜Portal 自己的 AI 工具来源，就是 `system_open_api` 这张表。**
- `erp-module-ai` 用 LangChain4j：`NewSkillAgenticRuntime` 用 `ToolSpecification`，而 `NewSkillApiInvokerImpl:65-80` **从 `system_open_api` 读出 `OpenApiRespDTO` / `OpenApiParamRespDTO` 转成工具规格**；技能节点绑 `apiIds`。
- 仓库里**没有任何 BPM / 会议室接口的工具定义**——这张表目前没登记流程类接口。
- → 对 Q51/Q52 的意义：**Portal 后端的 AI 已经和 `system_open_api` 对齐了**。SY 侧如果从 Portal 源码扫描生成能力目录，那就是**第三份**目录。而会话 token 不受这张表约束（F6/F7）——技术上走得通，但会形成两套工具世界。

**F18｜后端本来就有"当前用户的菜单树"接口 —— D8 的落地成本比想象低。** `HrSysMenuController.java:46-54` 的 **`GET /admin-api/sys/menu/nav?project=` 返回的就是按当前用户过滤的菜单树**（`SysMenuDTO extends TreeNode`，含 `children[]`、`permissions`、`useSystem`、`project`、`menuType`）。同类还有 `menuListNotBySystem`、`selectRoleMenuListNotBySystem`、`select-role-menu-by-tenant?useSystem=`（`:139-169`）。**Portal 前端不用它，是因为菜单是前端静态常量。** **[代码]**

> → **Q104 有了答案：接口已经存在，不需要新做。** D8 说"后端返回目前所有的菜单 + 路由推荐"，前半句是现成的，后半句（路由推荐）才需要 SDK 生成。
> 顺带：`SysMenuDTO.permissions` 一个菜单行可以带多个权限码（逗号分隔），`useSystem` 的值是 1人/2财/3物/4产/5供/6销/8科技 —— 和 `module-type` 是两套编号，别混。

**F19｜`module-type` 的真实作用被我说反了：不传它，看到的是"更多"数据，不是更少。**
- 后端在 `TokenAuthenticationFilter.java:273-290` 读 `module-type` 存进 `LoginUser.moduleType`。它**只影响数据范围（数据权限）**：84 个 `@DataScope` 调用点用它筛 `hr_role_module_data_scope_rel`；`RoleDataScopeAspect.java:228-240` 的注释写得很直白——**"兼容旧版本，如果不传则取该用户所有模块的数据权限"**。
- 它**不影响权限码校验**（`hasAnyPermissions` 从不读它），也**不影响菜单**（菜单由 `use_system` + `project` 管）。
- 另外 `module-type` 是 `sys_module.id`（如 8/11/12/21/60/101），不是一个小枚举；值非法会被静默忽略。
  **[代码]**

> → **H2 的结论要改写**：无头 SDK 不传 `module-type` 的后果不是"功能缺失"，而是**数据可见范围被放大到该用户全部模块的并集**。这在 D4（全部放开写操作）下是安全问题，不是体验问题。所以 `module-type` 不但要传，而且要**传对**。

**F20｜短信验证闸门在后端根本不存在——它只是浏览器里的一道门。**
- `SendSmsController.java:32-77`：`/sys/sms/send` 的 `templateId` 参数**被接收但从未使用**，业务码硬编码为常量 `hr-sensitive`；`/sys/sms/checkSms` 只是拿 `requestId` 去 Redis 比对。
- **没有任何后端端点要求或校验短信码**；没有任何拦截器/aspect 读那缓存（`HrCacheUtils` 的全部引用只在这一个文件里）。
- `hr_sensitive` 表和 `HrSensitiveService` 是**通知接收人名单**（字段只有 mobile / email），**不是"敏感操作注册表"**，也没有任何其它类注入它。
- 附带一个 bug：一分钟限流的 key 用了默认 1 小时 TTL，所以"一分钟只能发一条"实际把该手机号锁最长 1 小时。
  **[代码]**

> → **D5 的性质要修正**：原以为"把一道安全门搬到 SY 客户端"，事实是**这道门目前只在浏览器里存在、后端不认**。直接调删除接口就能绕过它。所以 D5 真正的决定是：**这道门要不要存在？如果要，它必须建在后端**（后端绑定"这个验证码属于哪个用户、哪个操作"），SY 客户端只是它的一个呈现端。反之如果只在 SY 客户端做，它保护不了任何东西——包括浏览器里的用户也照样能绕。

**F21｜凭据生命周期：改密码不失效，停用不即时生效，最坏情况 7 天。**
- **改密码**：`HrSysUserServiceImpl.updatePassword:461-466` 只写库，**不撤销任何 token、不清理任何缓存**。已签发的 token 继续可用。**[代码]**
- **停用用户**：状态**只在登录时校验**（`AdminAuthServiceImpl.java:95` 和登录 SQL 的 `where status = 1`）。请求链路的过滤器不重查状态。→ **被停用的用户，在 JWT 到期前仍有全部权限**；JWT 有效期 **30 分钟，"记住我"7 天**（`HrJwtUtils.java:40-45`）。**[代码]**
- **删除用户**：靠一个副作用失效（用户查不到 → `tenantId` 为 null → 过滤器跳过 `setLoginUser`），**不是主动撤销**。**[代码]**
- **登出是空操作**：`hr_sys_user_token` 表存在、`ShiroService.getByToken` 存在，但**零调用者**；HR 路径的 logout 对 JWT 持有者不产生任何效果。（`/admin-api/system/auth/*` 那套 OAuth2 token 倒是可撤销的，但那是另一条链路。）**[代码]**

> → 这直接回答 Q67/Q68，而且给 D1 加了一个硬约束：**会话 token 一旦泄漏或被停用，没有任何机制能让它立刻失效**。SY 侧的"断开连接器"因此只是单方面的。

**F22｜权限校验是精确字符串匹配，没有通配和层级。** `@ss.hasPermission` → `HrPermissionApiImpl.hasAnyPermissions:67-82` → `Set<String>.contains` 精确匹配。全仓约 **1,045** 个 `@PreAuthorize`。失败返回 `403 没有该操作权限`（HTTP 200 + JSON body）。权限码有两种风格并存：**路由路径式**（`/dashboard/manage/cost-center`）和**冒号式**（`sale:manual-order:submit-order`）。**[代码]**

> 对 H9 的好处：能力可见性可以直接用 `/sys/menu/nav` 的菜单树的 `permissions` 字段算，不用另建映射。

**F23｜还有两条"机器对机器"通道，都和 D1 的选择相关。**
- **内部系统 token**：`X-ERP-Internal-System-Token`，HMAC-SHA256，**30 秒有效期**，只允许 `/admin-api/`，必须带匹配的 `tenant-id`。**它设置 `systemIdentity=true`，会绕过全部权限检查和全部数据权限规则**（`SecurityFrameworkServiceImpl.java:30-32`、`OrganizationDataPermissionRule.java:97-99`）。nonce 不跟踪，窗口内可重放。**[代码]**
- **合作方通道**（见 F11）：`/open-api/**`，签名 + 限流 + 调用日志。
> 两条都不适合 D1（前者没有用户身份且绕过一切，后者不是用户身份），但值得知道它们存在——如果将来要"服务端自己做事"（不是代理用户），内部系统 token 是现成路径。

**F24｜只有 `/admin-api/`、`/adminmanage-api/`、`/open-api/` 需要认证。** `/api/**`、`/app-api/**`、`/admin-crm-api/**`、`/mall-api/**`、`/admin-shop-api/**`、`/mall-manage-api/**`、`/market-api/**` 在 Spring Security 里是 blanket `permitAll`。**[代码]**

> 对 D3 的意义：D3 选定"只做 Portal 主后端 `/admin-api`"——恰好是认证边界最完整的那个前缀。这是个好边界。

**F25｜限流只在登录/短信/改密，业务接口没有全局限流。** 登录按 IP 5/分钟 + 账号 10/小时；短信按 IP 10/分钟 + 手机 1/分钟；改密码 5/小时/用户。**仓库里没有任何 IP 白名单、WAF 配置或 `limit_req`**（只有两份文档性质的 nginx 示例）。`deviceCode` 只是 JWT 里的一个 claim，**没有任何过滤器在业务请求上校验它**。**[代码]**

> → Q64/Q65 有了答案：**不需要 IP 白名单、不会被设备指纹挡**（目前）。但反过来说，也**没有速率保护**——SDK 一次调用补发十几次基础数据请求（F4），峰值要自己控。

**F26｜多租户是"用户行上的列"，省略 `tenant-id` 会静默取错租户。** 同一手机号在 `hr_sys_user` 里对应 N 行（每租户一行）；登录 SQL 是 `where status = 1 and mobile = #{phone}` + **`<if test="tenantId != null">and tenant_id = #{tenantId}</if>`** + `order by id desc limit 1`。**省略 `tenant-id` 时会静默选中 id 最大的那一行**，而不是报错。**[代码]**

> → 与 F9 合起来看：缺 `tenant-id` 在有的路径被回填、在有的路径被静默猜。**SDK 必须显式传 `tenant-id`**，不能依赖"省略"。

---

## 3. 隐藏设计点

### 第一梯队 —— 会改写设计结构

#### H1｜凭据与能力边界：是"整个 Portal"，还是"开放接口白名单"？

**现象**：F1 的私人令牌 + F2 的开放接口注册表，合起来已经是一个完整的"给外部程序/LLM 用 Portal"的产品面：平台管理员登记接口（带 `scopeKey`、参数树、返回示例、`enabled`），用户建一个带 `scopeGroups` 和有效期、可吊销的令牌，把自己被授权的接口文档复制走。

**为什么重要**：这决定了整个项目的形状，两个分叉差一个数量级：

- **分叉甲：以「开放接口」白名单为边界。** 能力目录 = 注册表里的 `enabled` 接口，权限 = 令牌的 `scopeGroups`，SY 侧只需要做"目录获取 + 调用 + `llm` 增强"。工作量小，边界清晰、可审计，Portal 侧已有管理界面。
- **分叉乙：以「Portal 全部页面/接口」为边界。** 就是 A6 说的"页面名-list"，覆盖约 850 个菜单页、2,736 个去重接口路径。能力目录要 SY 侧从代码生成，权限只能靠用户 `permissions`，令牌 scope 未必覆盖得了。

**要你定的问题**：
1. 私人令牌调用 `/admin-api/**` 的**普通业务接口**时，后端是**只认开放接口白名单**（`scopeKey` 必须登记过），还是**认令牌的 scopeGroups**、还是**完全等同该用户的会话权限**？ **[后端]**
2. Headless 的目标是"AI 能操作 Portal 的**全部**页面"，还是"AI 能操作**被登记且被授权**的接口"？
3. A4 的浏览器回调流程，在 F1 面前是否还需要？如果还需要，它相对私人令牌的**独有价值**是什么（例如"零配置、不用手工建令牌"）？

**我的建议** **[已被 D1/D2 覆盖]**：以「开放接口白名单」为**第一期边界**，私人令牌为**默认凭据**。理由：范围可控、权限可解释、吊销有入口、审计有依据；浏览器回调作为后续"免除手工建令牌"的体验优化，而不是地基。

**已决策**：D1 走浏览器回调拿会话 token；D2 边界是全部页面。

**后端已查证（见 F6/F7），本条关闭**：私人令牌是 `access_token` 头 + `system_open_api` 白名单，未登记接口一律 401；会话 token 是 `Authorization`/`token` 头（也接受 query），会加载完整 `LoginUser` 的全部角色与权限上下文，能访问用户本就有权访问的全部 `/admin-api`。**所以"用私人令牌打底"与 D2 在物理上不可兼容，D1 是正确的选择，我的原建议作废。**

---

#### H2｜无头没有 URL，但 `module-type` 决定后端返回什么

> ⚠️ 实测校正（2026-09-20，**只针对标题与下面的"为什么重要"**）：**"决定后端返回什么"这个说法是错的。** 后端查证（F19）的结果是：`module-type` **只影响数据范围（数据权限）**，不影响权限码校验（`hasAnyPermissions` 从不读它），也不影响菜单（菜单由 `use_system` + `project` 管）。准确的说法是"它决定后端**返回哪些行**"，不是"返回什么"。
> 更要紧的是方向：**不传它拿到的不是更少的数据，是"该用户全部模块数据权限的并集"（`RoleDataScopeAspect.java:228-240`）——是放大，不是缩小。** 在 D4（写操作全放开）下这是安全问题。`docs/conventions.md` 第 1 条。
> 本节下面"最小调度单位是页面/能力"那条结论**仍然成立**（`module-type` 确实只能先知道页面才能算），受影响的只是它的理由。

**现象**：见 F3、F3b。

**为什么重要**：这不是"补一个 header"这么简单。`module-type` 表达的是"这次操作发生在哪个业务系统模块里"，同一个 `GET` 在不同模块下语义不同；`all_menus_type_match` 是一张"路径前缀 → 模块号"的表，也就是说**只有先知道"页面"，才能知道"模块号"**。这直接证明：

> **无头 SDK 的最小调度单位是「页面/能力」，不是「接口」。** 调用方必须先说"我要在哪个页面做事"，SDK 才能拼出正确的 `module-type`。

你的 A6 用 `{页面名}-list` 的命名，实际上已经隐含了这个结论，但 A2/A3/A5 描述缓存和调用时又是按"接口"讲的 —— 两处不自洽。

**要你定的问题**：
4. `module-type` 由谁决定：由能力（页面）静态声明？由 SDK 按目标路径反查 `all_menus_type_match`？还是每次调用让 AI 显式传？（代码里三种都有先例：页面静态声明 55 处，反查是默认行为，显式传参是已有的 override）
5. 当反查不到模块号时（现在浏览器会返回 `undefined`，即不发这个头），无头侧应该**拒绝调用**还是**照发不带该头**？

**我的建议**：能力声明为主（写进能力目录），反查为辅做校验，两者不一致时**报错而不是猜**。第二优先：反查不到就拒绝。

**后端已查证（见 F19），结论要改写**：我原先担心的"不传 `module-type` 会拿不到数据"是错的。它**只影响数据范围**，而且**不传反而会放大范围**——`RoleDataScopeAspect.java:228-240` 的注释明写"如果不传则取该用户所有模块的数据权限"。所以：

- Q4 的答案从"谁来算"变成"**必须算对**"：SDK 的每条能力都要携带正确的 `module-type`。
- Q5 的答案变成"**必须拒绝**"：反查不到时不能照发不带该头的请求，那等于把数据范围开到该用户全部模块的并集。
- 这条在 D4（写操作全放开）下是**安全问题**，不是体验问题。

> ⚠️ 实测校正（2026-09-20）：上面三条里，**前两条各有一半不成立**。
>
> 1. **"必须算对"只适用于能算出值的页面。** §1d 实测：清单里 **427 / 1,019（42%）** 的页面在 `all_menus_type_match` 里匹配不到任何规则（`generated/page-catalog.json` 里 `moduleType` 为 null 的就是这些），**浏览器在这些页面上本来就不发这个头**。所以"算对"的分母是那 58%，不是全部。
> 2. **Q5 的"必须拒绝"已被 D34 推翻。** D34 的选择是**与浏览器保持一致**——算不出就不发，接受与浏览器完全相同（也就是那份更宽的并集）的数据范围。落地形态是 `resolveModuleType(pagePath)`，算不出返回 `{ moduleType: null, matchedBy: 'none' }`，请求照发、不发这个头（`src/context/module-type.ts:91`）。注意这与 http 实例的处置**刻意相反**：实例算不出是**拒绝发请求**（`docs/conventions.md` 第 26 条），因为走错实例会打到错的 URL，失败方式静默。
> 3. 第 3 条（是安全问题不是体验问题）**仍然成立**，而且正是 D34 明知而选择接受的那部分风险。

---

#### H3｜"Portal 的页面"有一批根本不是 Portal

**现象**：菜单里有 8 处指向 BPM 流程引擎 iframe（`app/portal/menus/hr.js`，`ROUTE_FRAME_PATH = '/dashboard/frame'`，见 `app/portal/utils/menu.js:9-25`），iframe 页面把 `token/tenant/user/system/baseurl` base64 进 src，靠 8 种 `postMessage` 与宿主通信（`views/dashboard/common/frame/index.vue`）。此外前端有 **17 个文件、18 个 axios 实例**（`app/portal/utils/http/`；`zhdj-cms.js` 一个文件导出两个绑定），其中 **4 个与主后端同 host 不同前缀**（`sale` / `platform-mall-admin` / `mall-app` / `crm`），其余才是不同 host，各自的错误码数组、鉴权头、Content-Type 处理都不同。**[代码]**

> ⚠️ 实测校正（2026-09-20）：原文写"**17 个 axios 实例指向不同域名**"，两处都不准。
> **① 单位错了**：一个文件可以有多个实例——`zhdj-cms.js:106-107` 导出 `httpLay` 与 `http` 两个绑定。所以是 **17 个文件 / 18 个实例**。
> **② "指向不同域名"错了**：**4 个与主后端同 host、不同前缀**（测试环境实测：`sale` → `/admin-shop-api`、`platform-mall-admin` → `/mall-manage-api`、`mall-app` → `/mall-api`、`crm` → `/admin-crm-api`）。这几个恰恰是 D3 那条"只做 `/admin-api`"边界**最难受的部分**——它们是 Portal 页面，但请求打到另一个前缀。
> **③ 原文举例里的 `education` / `fm` / `market` 是 env 变量名，不是实例名**，`app/portal/utils/http/` 下没有这三个文件。
> 逐个实例的完整画像（baseURL / 补不补前缀 / 分页参数名 / 请求头形态 / 序列化 / 响应包络）见 `src/context/README.md` §1a，出处逐条带 `文件:行号`；由此推出的硬约束见 `docs/conventions.md` 第 24–29 条。

**为什么重要**：
- 同一个"页面"背后可能是另一个系统、另一套 token 语义。`token` 头虽然都叫 `token`，但**未必是同一个用户体系**。
- BPM 审批引擎的操作（审批、退回、加签）要通过 iframe 的 HTTP 接口直接做，没有 iframe 就没有那 8 种消息协议兜底。
- 第一期如果把这块算进来，工作量不是 1 倍而是数倍。

**要你定的问题**：
6. 第一期的范围边界：只做 Portal 主后端（`VITE_ZHDJ_PLATFORM_API` → `/admin-api`）、还是包含 iframe 里的 BPM 引擎、还是连独立域名系统一起？
7. 如果包含 BPM：审批类操作（通过/退回/加签）是否在 AI 可自主执行的范围内？（见 H4）

**我的建议**：第一期明确排除独立域名系统；BPM 只做**只读**（查待办、查流程详情），写操作留到有人工确认通道之后。

**已决策（D3）**：只做 Portal 主后端（`VITE_ZHDJ_PLATFORM_API` → `/admin-api`）；Q7 不适用（BPM 已出范围）。但要记住 D3 排除的是 iframe 里的**流程设计器 UI**，不是 BPM 接口——后者的接口就在同一个后端里（F12），D9 依赖的 `create-list` 因此与 D3 不冲突。

---

#### H4｜写操作的安全门全在 UI 里，无头下没有"人点了确认"

**现象**：见 F5。实测统计（本次扫描 `app/portal` + `common`，方法为静态正则，209 处 URL 是运行时变量无法枚举，属下限）：

| 项 | 数量 |
| --- | --- |
| 写请求调用点（POST/PUT/DELETE） | **约 1,900**（含其它 client 约 2,019） |
| 去重后的写接口路径 | **1,374**（POST 995 / PUT 286 / DELETE 130） |
| `DELETE` 调用点 | 163，分布在 139 个文件 |
| 批量导入类接口 | 94 条路径（薪资导入、社保导入、期初导入、资产导入…） |
| 产出文件的导出接口 | 113 处 |
| `Modal.confirm` | 165 处 / 129 文件，其中 154 处在 `onOk` 里 |
| `a-popconfirm` | 50 处 |
| `<common-action-delete>` / `-multiple` | 526 / 82 处 |
| `.validate(` | 417 处 / 386 文件，其中 **185 个文件同时含写请求** |

覆盖的业务域（按去重路径）：财务 375、系统/用户/组织 158、人力/组织 152、销售/CRM 139、采购/物资/库存 106、生产 61、审批流 53。含**工资实发、社保公积金、凭证生成、年度结转、坏账核销、期初过账、权限与租户变更**等。

另外：后端 `web-operation-log` **只在错误路径记录**，不是全量请求日志（见发现记录 §10）；写成功后的客户端行为有 1,390 处 `message.success`、1,621 处列表刷新、1,019 处路由跳转，而**缓存失效只有 15 处**（其中一半在 logout）。

> D4 选了全部放开，所以上面这 1,374 条路径都在范围内。H34 说明其中至少两类现在**走不通**。

**为什么重要**：A5 说"可执行用户侧全部 Portal 操作"。在浏览器里，"用户点删除"这件事本身就是授权动作；在无头里，AI 自己就能触发它，**授权链条断了**。而且这个断点不是技术问题，是产品/合规问题：AI 误删一条工资数据，谁负责。

**要你定的问题**：
8. 写操作的分级规则是什么？我的草案是三档，请你改：
   - **只读**（查询、列表、详情、报表）：AI 自主执行
   - **低风险写**（新建草稿、填写表单但不提交、发起审批）：AI 执行 + 结果回执
   - **高风险写**（删除、审批决定、金额/工资/凭证、权限与组织变更、批量导入）：**必须**回到 Portal 页面或 SY 客户端由人确认，SDK 只提供"预演"（把要提交的 payload 给人看）
9. 能力目录里的每个能力，是否需要显式标注风险档位？（如果是，谁来标 —— 平台管理员在开放接口注册表里标，还是 SY 侧按规则推断）
10. 页面里"现算提交值"的那些业务规则（如 `getSubmitStatus()`），无头侧怎么处理？**照抄一份到 SDK**（会随版本漂）、**要求这些页面改造成可复用函数**、还是**这些页面第一期不开放写能力**？

**我的建议** **[已被 D4 覆盖]**：三档 + 高风险必须人工确认 + 第一期对"需要现算业务规则的写页面"直接不开放。

**已决策**：D4 全部放开，不做分级、不设人工闸门。纳入 D4 后，本条的问题 10（页面内"现算提交值"的业务规则）**升级为必须解决**：这部分规则目前只存在于 `.vue` 文件里，无头侧要么照抄一份（会随版本漂），要么推动页面改造成可复用函数。见 §3.5 第 2、5 条。

---

### 第二梯队 —— 决定实现形态

#### H5｜缓存键与缓存内容：一次"会话"到底是什么

**现象**：见 F4。补充：Portal 自己已经有一套**声明式的基础数据加载**机制 —— `BASE_DATA_REGISTRY`（`app/portal/utils/router/base-data.js:57-104`，含 `user-basic / tenant-context / tenant-system / security-config / dict-hr / dict-platform`，每项有 `load / deps / critical / onlySimpleForm`），配合路由 `meta.baseData` 声明和 `simple-lite` profile（`init-profile.js`）按页面按需加载，失败自动回退全量链路。**[代码]**

**为什么重要**：A3 说缓存"权限列表等数据"，但没定义边界。缓存全量 18 个 store 意味着：内存随用户数线性增长（字典、组织树、门店、区域、品牌…都不小），且 TTL 内字典/组织变更不可见。Portal 已有的 `BASE_DATA_REGISTRY` 恰好回答了"哪些是公共依赖、哪些只有某些页面要"。

**要你定的问题**：
11. 缓存键：确认是 `(SY 用户, 凭据, tenantId, Accept-Language)`？多租户用户的租户切换谁决定（用户在 SY 侧选，还是连接时固定一个）？
12. 缓存内容：**全量 18 个 store** / **只缓权限+租户+系统开通** / **复用 `BASE_DATA_REGISTRY` 按能力声明按需加载**（我的建议）
13. TTL 语义：**空闲过期**（"就像浏览器不关标签页"）还是**绝对过期**？注意空闲过期意味着高频用户永远不重新校验凭据是否已被吊销 —— 安全与成本直接对立。
14. 缓存上限与淘汰：有没有最大用户数 / LRU / 内存水位？溢出时的行为是什么（拒绝新用户 / 淘汰最旧 / 降级为每次重建）？

**我的建议**：键 `(用户, 凭据, tenantId, language)`；内容复用 `BASE_DATA_REGISTRY` 的声明式加载；TTL 用**绝对过期 + 空闲过期取先到者**（两者都设），默认各 30 分钟；加内存上限，溢出走 LRU 淘汰并记日志。

---

#### H6｜凭据过期与吊销：无头下没有"跳登录页"这个动作

**现象**：见 F5。会话 token 无刷新流程；401 直接 `logout()` → `router.replace('/login')`。私人令牌有独立吊销入口（`personalToken/delete`）和 `lastUsedTime`。**[代码]**

**为什么重要**：浏览器里 token 过期是"用户重新登录"；无头里它是"这个能力突然开始失败"。而且**吊销是不通知的** —— 用户在 Portal 删了令牌，SY 侧要等到下次调用失败才知道。

**要你定的问题**：
15. 凭据失效时 SDK 的行为：**明确失败并返回可操作错误码**（推荐）/ **主动通知 SY 客户端弹浏览器重新授权** / **两者都要**？
16. 是否需要"保活/预检"机制：在空闲时定期校验凭据仍有效，避免用户以为能用、真要用时才失败？
17. 用户 "断开连接器" 时（SY 侧关闭开关），要不要**同时调用 Portal 侧吊销令牌**？（会话 token 无法吊销，这是私人令牌才有的能力）

---

#### H7｜版本对齐：不必靠"人工过滤 UI 提交"

**现象**：构建期 `vite.config.js:104` 生成 `buildId`（毫秒时间戳），写进产物 `dist/build.json`（`{"unix":…,"buildId":"…"}`）并 bake 成 `__BUILD_ID__`；前端已有 build-version guard 每 10 秒轮询 `build.json` 比对（`app/portal/hooks/use-build-version-guard.js`）。**[代码]**

**为什么重要**：A7 的做法（对比提交记录、人工过滤纯 UI 变更、严格版本相等）有三个问题：
- **人工判断会漂**：判断"这个改动是不是纯 UI"没有机器依据。
- **严格相等会断链**：Portal 每次发版到 SY 跟上之间，连接器有不可用窗口。而 Portal 发版频率不低（当前分支号已到 4.6.3.22）。
- **它把两件事混在一起**：产品版本（给人看、随发版走）和**接口契约版本**（决定 SDK 能不能用）不是一回事。一个只改了按钮颜色的发版，不该让连接器失效。

**要你定的问题**：
18. 是否把版本拆成两个：**产品版本**（4.6.3.22，人看）+ **契约版本**（由 SDK 生成产物的内容算 hash，或直接用生成时那份 Portal 源码的 `buildId`）？只有契约变了才要求同步。
19. SDK 的"当前版本"由谁权威：**读 Portal 部署产物的 `build.json`**（推荐，机器可查、无需人工登记）/ 服务端配置写死 / 连接器回调时由 Portal 页面告知？
20. 不匹配时的行为：**拒绝**（A7 原设计）/ **降级到只读** / **允许但警告**？

**我的建议**：拆两个版本；用 `build.json` 的 `buildId` 做机器校验；不匹配时**降级到只读并明确告知**，而不是整体拒绝。这样 Portal 发版不会把用户的服务打断。

---

#### H8｜"页面"有两套数据源，且靠约定对齐

**现象**：菜单树是**前端静态常量**（`menus/*.js` + `menus/product/*.js` 共 18 个文件，1,150 个节点、**928 个叶子**、929 个带 `path`），路由靠 `vite-plugin-pages` 的**文件系统约定**生成（3,640 个路由文件 → 3,635 条唯一路由），两者不是同一份数据源（见发现记录 §5.3）。

**实测对账结果**：菜单路径 → 路由文件 **878/880 = 99.8%** 对得上，只有 2 条对不上（疑似改名后的菜单残留）。反向差距极大：**2,757 条路由没有对应菜单项**。另有 5 条路由路径由两个文件生成（谁生效取决于生成顺序，静态不可判定）。**[代码]**

> 结论调整：**这次对账其实基本不需要做**——菜单侧几乎全部能落到路由上，风险不在"对不上"，而在"路由远多于菜单"（见 H36）。我原先担心的对账成本，实测不存在。

**为什么重要**：AI 说"薪资审核报表"，要映射到唯一一个页面/能力。两套数据源一旦有偏差（有菜单没页面、有页面没菜单、菜单指向 iframe），AI 的"页面名"就会指错，而且错得很隐蔽。

**要你定的问题**：
21. 能力目录以哪个为准：**菜单常量**（有 title + permission，最接近"人话"，我的建议） / 路由文件 / 两者对账后的合并结果？
22. 是否接受"做一次对账，把差异固化成显式例外清单"（而不是要求 100% 自动对齐）？
23. 菜单里**指向 iframe 或外部 URL** 的节点，在能力目录里怎么表示（排除 / 标记为"需跳转"）？

---

#### H9｜权限有两套，且不重叠

**现象**：用户权限来自 `GET /admin-api/sys/menu/permissionsNotBySystem`，返回一维权限码数组（`system.js:694-698`），菜单过滤和按钮权限都基于它（`permissionCheck` / `permissionFilter`）。**私人令牌**的权限来自 `scopeGroups`（分组名数组，见 F1）。两者是不同的东西。**[代码]**

**为什么重要**：AI 拿到的能力清单如果不按权限过滤，会出现"AI 说能做 → 实际 403"的失败；而如果用令牌 scope 过滤，又可能与用户在 Portal 里看到的菜单不一致。用户会困惑"为什么 AI 能做的事情和我能做的事情不一样"。

**要你定的问题**：
24. 能力可见性怎么算：**用户 permissions ∩ 令牌 scope**（推荐，取交集） / 只用令牌 scope / 只用用户 permissions？
25. 用户在「个人设置 → 私人令牌」勾选权限分组时，能不能看到"这个分组会让 AI 获得哪些页面能力"？（现在是按分组名勾选，颗粒度是分组，不是页面）

---

#### H10｜上传 / 下载 / 导出出不了服务端

**现象**：上传唯一出口是 `common/utils/oss.js`，用 `ali-oss`，AK/SK 来自前端 env（`VITE_OSS_V2_ACCESS_KEY_ID/SECRET` 等，**多套桶**：主桶 + education / mall / shop 各自的配置，共 20+ 个 env 变量）。下载靠 `Blob` + `document.createElement('a')`；还有一批**在前端生成**的导出物：docx（PizZip + Docxtemplater）、PDF（`html2pdf()`）、CSV、XML、TXT。另有"后端返回文件名、前端拼 `?token=` URL"的模式。**[代码]**

**为什么重要**：无头跑在服务端，没有 `<a>` 也没有 `<input type=file>`。而且把前端 env 里的 OSS AK/SK 搬到 SY 服务端，等于**把多套桶的长期密钥集中到一个新位置**，这是安全决策，不是工程细节。

**要你定的问题**：
26. 第一期是否**不开放**任何涉及文件的能力（收/发都排除）？
27. 如果需要开放"下载/导出"：接受**只返回下载 URL**（由 Portal 后端签发、带时限），还是要求 SY 服务端持有 OSS 凭据直传直取？
28. 前端生成的 docx / PDF 导出（如年度协议、员工信息导出），无头侧是**不支持**、还是**要求后端补一个导出接口**？

**我的建议**：第一期排除文件类能力；第二期只做"后端签发 URL"的下载，不做服务端 OSS 直传。

---

### 第三梯队 —— 会咬人，但不改结构

#### H11｜幂等：现在没有任何幂等键

**现象**：全仓 `idempotent / idempotency / Idempotency-Key / X-Request-Id / reqId / request_id / nonce / submitToken / repeatSubmit / clientId` **全部为 0 命中**（唯一命中的 `nonce` 是编辑器依赖里的样式标签）。`requestId` 有 169 处，但**没有一处是写给写接口做去重键的**：要么是短信验证的 `requestId`（`/sys/sms/send` → `/sys/sms/checkSms`），要么是 GET 请求的本地陈旧响应守卫。防重复提交完全依赖组件级的 `loading` 状态（按钮禁用），**没有任何在途请求登记**。**[代码]**

唯一像幂等的是服务端驱动的 `needConfirm` → 带 `isIgnore = true` 重发（`sales/visit-plan/create`），那是单接口的服务端标志，不是客户端可提供的幂等键。**[代码]**

**后端查证补充（见 F10）**：后端有一个完整的 `@Idempotent` 框架但零使用；`@RepeatSubmitLimit` 注解被 17 个 controller 标注却**没有处理器，是空注解**；真正在用的是 BPM 的 `client_request_id` + 唯一索引。**D12 的 SDK 侧去重可以照抄 BPM 的范式，不必从零设计。**

**为什么重要**：AI 重试是常态（超时、模型重发起）。无头下一个重试就是一条重复的报销单。

**要你定的问题**：
29. 是否要求所有写能力必带调用方 `requestId`，由 SDK 在 TTL 窗口内做去重？（注意：这只是"短窗口防重"，真正的幂等要后端配合）
30. 是否需要推动 Portal 后端支持幂等键？

> **已决策（D12）并已实现（2026-09-20 回填）**：写能力必带 `requestId`，SDK 在 TTL 窗口内去重。落在 `src/idempotency/*`，键是 `namespace|租户|用户|能力|目标|requestId`；**失败释放的分界线是"知不知道后端写没写"**（不知道就不释放，宁可挡重试也不放过重复单据）；已接进 `createPortalHeadless` 与 `createPortalServer` 两个门面，47 个用例 + 5 组反证。
> **边界要说清楚**：**它不是幂等**——进程重启、多实例部署、TTL 过后都不生效，所以 Q30「推动后端支持幂等键」**仍然要做**（F10 已经给出可照抄的范式：BPM 的 `client_request_id` + 唯一索引 `uk_bpm_follow_up_request`）。

---

#### H12｜审计：AI 做的事，Portal 侧不会留痕

**现象**：Portal 的 `web-operation-log` 只在错误/手动路径写入（发现记录 §10），不是全量请求日志。**[代码]**

**为什么重要**：AI 替用户执行的写操作，在 Portal 侧看起来和用户自己点的没区别。出了问题无法回答"这是谁做的"。Synapse 侧有 `AuditSink`，但那是 SY 自己的账。

**要你定的问题**：
31. SDK 发出的请求是否统一带一个可识别标识头（例如 `x-client: synapse-headless` + 调用方 SY 用户标识），让 Portal 后端能区分、能审计、必要时能一键掐断某类来源？
32. 这需要 Portal 后端配合记录吗，还是先只加头、观察？

---

#### H13｜契约细节：包络形状、分页字段名、上下文预算

**现象**：
- 响应包络是 `{ ret, code, msg, data }`（`platform.js:102-141`），**不是** A6 写的 `data/code/message`。`msg` 是给人看的业务提示，前端用 `message.error(msg)` 直接展示。
- 分页参数名**不统一**：renren 默认是 `limit`，portal 在 `main.js` 里覆写成 `pageSize`（`common/libs/renren/config.js:9-10`、`app/portal/main.js:44-45`）；而且 `sale.js` 会把请求里的 `pageSize` **转成 `limit`**（`.codex/skills/everything-portal/references/http-and-module-type.md`）。
  > 实测校正（2026-09-20）：**全局默认是 `pageSize`**（`common/libs/renren/config.js:11` 写的是 `limit`，被 `app/portal/main.js:48` 覆写掉）；**改名的只有 `sale.js` 一个实例**；此外页面还能**逐页**覆写 `fieldNamePageSize`（实测 `/dashboard/flow/old/model/list` 真的发 `limit=20`，且它走的是 `platform.js`）。所以"分页参数叫什么"= 页面声明 × 实例要不要改名。出处 `src/context/README.md` §1b「差异三」、`docs/conventions.md` 第 25 条。
- **每个 HTTP client 的返回语义不同**（同上参考文档）：`platform.js` 默认返回 `data`；`product.js` 会把单 key 的 `data` 解包；`crm.js` 支持 `sourceResponse`；`smart-layer-admin.js` 接口无 `code` 时返回原始 `response.data`……换句话说，**"统一响应契约"这件事在 Portal 里本来就不存在**。
  > **D3 在这里帮了大忙**：既然一期只做 Portal 主后端，SDK 只需要实现 `platform.js` 一套语义，其他 client 的差异可以先不管。这条建议写进实现约束。
  >
  > ⚠️ 实测校正（2026-09-20）：**"其他 client 的差异可以先不管"只对了一半。**
  > - **响应包络**这一半成立：`src/http/client.ts` 只实现了 `{ret, code, msg, data}` + `ret === 'SUCCESS'`，另外三种形态（`code === 0` / `code === 200` / 返回整个包络）**在发请求前直接抛 `HttpInstanceUnsupportedError`**，没有拿标准判据去套（理由见 `src/context/README.md` §1d）。
  > - **请求侧的差异**这一半不成立：`baseURL`、补不补 `/admin-api`、分页参数叫 `pageSize` 还是 `limit`、发哪几个头、GET params 怎么序列化，**每一个都取决于页面走哪个实例**。实测 **262 个页面 import 了非默认实例**，其中 21 个在列表请求之外还直接打另一个实例。所以"只做主后端"不等于"只有一种请求长相"。
  > - 出处：`src/context/README.md` §1a–§2c、`docs/conventions.md` 第 24–29 条。SDK 的处置是**逐请求**的 `httpInstance`：页面推导只给该页列表请求的默认值，算不出就拒绝发请求。
- **单请求级的隐藏开关**：`silenceOnError`（145 处）、`silenceOnSuccess`（62）、`useJsonPost`（50）、`sourceResponse`（18）、`silenceCodes`（10）、`transformUndefinedToNull`（6，`http/hr.js:18-22` 把 body 里的 `undefined` 转成 `null`）、`paramsArrayFormat`（5）。这些是**每个调用点单独设的**，直接影响请求发出去长什么样；SDK 复刻一个能力时必须连这些开关一起复刻，否则行为不等价。
- **URL 不等于字面量**：`platform.js:18-20` 会把不以 `/admin-api`、`/adminmanage-api`、`/mall-manage-api` 开头的路径**自动补上 `/admin-api`**——但**三个边界条件缺一不可**（实测校正，2026-09-20）：① **必须以前导 `/` 开头**，漏写斜杠的相对路径**原样发出**（实测存在这类页面）；② 命中那三个前缀之一就**透传不补**；③ 判断发生在 **baseURL 拼接之前**。另外**只有 `platform.js` 有这段拦截器**（`sale.js` 没有，见 H3 的实测校正）。所以源码里写的路径未必是线上路径。出处：`src/context/README.md` §1b、`docs/conventions.md` 第 25 条。
- 错误已经是结构化的：拦截器抛出的 Error 带 `ret / bizCode / bizData / responseData`（`platform.js:130-135`），还有现成的 `silenceOnError / silenceOnSuccess / silenceCodes` 开关。
- A6 的两层接口（`{页面}-list` / `{页面}-list-llm`）× 约 850 个页面 = 上千端点。

**为什么重要**：`llm` 字段该加在**真实包络**的顶层；上千个端点的目录本身就会撑爆上下文，A6 说的"渐进式查询"需要第三层（总目录 → 模块 → 页面能力），而 A6 只写了两层。

**要你定的问题**：
33. `llm` 字段的位置：加在 `{ret, code, msg, data}` 顶层的 `llm`（推荐，不改动 `data`，现有前端不受影响）？
34. 是否需要第三层目录接口（如 `Plugin/Portal-Headless/catalog` → 模块 → 页面 → 能力）？
35. 列表类能力的返回是否有**行数上限与字段裁剪**？（否则一次 `-list` 就可能几万 token）
36. `-llm` 文档谁生成、谁维护？手写 850 份不现实 —— 从菜单树 + 提取的契约 + 字典生成是唯一可行路径（Gen 的输入就是你 A7 里说的"扫描抽象"）。

---

#### H14｜凭据的归属：存在客户端，却要在服务端用

**现象**：A4 说 token 存在**用户本地客户端**，A5 说 **SY 服务端**实例化 SDK 调 Portal。**[推断]**
补充：Synapse 已有 `secrets` 能力（`desktop/app-capabilities/secrets/`，MCP 工具 `app_secrets_item_{list,get,create,update,upsert,delete}`），凭据有现成的存放位置，不必自定义文件格式。**[代码]**

**为什么重要**：这两句话合起来意味着 token 必须每次都从客户端带到服务端，或者服务端持久化它。这决定了：
- 服务端是否会出现**明文 Portal 凭据**（内存里 / 落盘里）；
- 用户换一台设备是否要重新连接；
- 服务端重启后缓存丢失，用户是否要重新走一遍授权；
- 这与 Synapse 自身的安全纪律（凭据走 secret、`PermissionGuard`、`AuditSink`、日志不落正文）怎么对齐。

**要你定的问题**：
37. token 到底存在哪：**客户端 secret 存储、每次请求上传**（服务端只在内存持有）？**服务端持久化**？**两者都有**？
38. 用户在**多台设备**上时，是同一份凭据还是每台各自一份？
39. SY 服务端重启后，用户是否需要重新授权？

---

#### H15｜这在 Synapse 里算哪一类东西

**现象**：Synapse 现有的"连接器"是**纯客户端内置**的：`docs/superpowers/specs/2026-09-03-builtin-mcp-skill-connectors-design.md` 明确写了 V1 **不建设云端 Connector Catalog，也不支持 OAuth、Token、多账号、多环境、远程 MCP**，且"新增或修改连接器仍需发布 Synapse 客户端"，endpoint 只接受 `http://127.0.0.1:<port>`。**[代码]**

**为什么重要**：Portal Headless 是这个产品里**第一个"远程 + 带凭据"的连接器**。按现有设计，它不该硬塞进 Connector 概念里 —— 那会一次性推翻 V1 的四条明确非目标。而且 A4 里"用户开启连接器开关时向服务端请求获取 SDK 版本"，本身就要求服务端知道这个连接器有哪些、什么版本，也就是需要一个**云端连接器目录**。

**要你定的问题**：
40. 它走**现有 Connector 概念并扩展其边界**，还是走**一个新的概念**（例如"外部数据源/集成账号"）？
41. 如果扩展 Connector：那四条非目标（云端 Catalog、OAuth/Token、多账号、远程）是**逐条重新决策**，还是只有 Portal Headless 特例？
42. "服务端下发 SDK 版本"这个能力，是做成通用的云端连接器目录，还是先给 Portal 开一个专用配置项？

---

#### H16｜部署形态决定缓存能不能是"进程内内存"

**现象**：A1 明确"不依赖任何数据库存储"。**[推断]**

**为什么重要**：如果 SY 服务端是多实例，进程内缓存就是每实例一份 —— 同一个用户的凭据会被重复校验、"登录一次拿到的基础数据"会被重复拉取，成本 ×N；更麻烦的是行为不一致（不同请求落到不同实例，看到的缓存状态不同）。

**要你定的问题**：
43. SY 服务端是单实例还是多实例？
44. 如果多实例：接受缓存 ×N、还是要求粘性路由、还是允许引入共享缓存（Redis 是否算"数据库"？我的理解是不算，但需要你确认这条红线的范围）？

---

#### H17｜回调流程缺一个"人看见"的环节

**现象**：A4 的流程里，临时密钥（state）防的是"别人拿我的连接器 URL 来访问"。但反方向的攻击没有防：**用户被诱导去连接一个别人的 Portal 账号**（点一个恶意构造的 Portal 路由地址，回调把攻击者的 token 和租户塞进无辜用户的 SY 客户端），此后这个 SY 就一直在操作攻击者的数据。OAuth 对此的答案是**授权同意页**：明确展示"你正在把 X 账号/Y 租户授权给 Z 应用"。A4 里没有这一页。**[推断]**

**为什么重要**：这是安全设计缺口，且补起来便宜（在 Portal 路由页展示"即将连接的账号 + 租户 + 权限范围"，用户点确认才回跳）。

**要你定的问题**：
45. 回调前是否加一次**用户可见的确认**（展示 Portal 账号、租户、将要授予的范围）？
46. 临时密钥的有效期、一次性还是可复用、绑定到哪个 SY 用户？

---

#### H18｜`Plugin/Portal-Headless/` 这个前缀在两个仓库里都不存在

**现象**：Portal 前端的 URL 字面量前缀只有三种：`/admin-api`（2,700+ 处）、`/adminmanage-api`（157 处）、`/app-api`（6 处）；全仓搜不到 `Plugin/`。Synapse 服务端的路由前缀是 `/api/**`，其中对外的是 `/api/open/v1/**` + `/api/open/openapi.json`，鉴权用 Bearer API Key，能力登记在 `API_KEY_CAPABILITIES`（`server/src/api-keys/api-key-capabilities.ts`，每项含 `scope / name / description / documentationPath`），并已有 **usage log**。**[代码]**

**为什么重要**：
- `Plugin/Portal-Headless/{页面名}-list` 是一套**新的命名与路由风格**，与 SY 已有的 `/api/open/v1/**` + 标准 OpenAPI 3 不一致。同一个产品里两套"开放接口"风格，长期会分叉。
- 更关键的是**能力登记方式**：SY 已有 `API_KEY_CAPABILITIES` 这种"scope + 文档路径"的登记表，Portal 已有 `openApiRegistry` 这种"接口 + 参数树 + 面向 LLM 的 Markdown"的登记表 —— 而 A6 的方案是**第三套**（从代码扫描生成）。
- 如果目标是"AI 能理解并调用"，标准 OpenAPI 3 + 每个能力一份文档，和 `{页面}-list` + `{页面}-list-llm` 是两种不同取舍：前者是生态兼容，后者是 token 效率。

**要你定的问题**：
47. 路由与鉴权风格：**沿用 SY 已有 `/api/open/v1/**` + Bearer + scope**（我的建议）/ 新起 `Plugin/Portal-Headless/` 前缀 / 其他？
48. 能力登记放哪：**复用 SY 的 `API_KEY_CAPABILITIES`**（SY 侧能力）/ **复用 Portal 的 `openApiRegistry`**（Portal 侧能力，见 H1）/ 代码扫描自动生成（A7 原设）？

---

#### H19｜A4 的回调地址，应该注册进 Synapse 已有的协议路由体系

**现象**：Synapse 客户端已经实现了"浏览器 → 客户端"的回调通道，而且不是临时方案：

- `desktop/electron/generated/deployment-config.generated.ts:7` 有 `desktopRedirectUri: "synapse://auth/desktop/callback"`；
- `desktop/electron/bootstrap/protocol-router.ts:44-58` 按 hostname `auth` + pathname `/desktop/callback` 精确匹配并交给 `handleAuthCallback`；
- 同一个 router 还处理 `synapse://skill-install/...`、`synapse://update?token=...`；
- 更通用的机制在 `desktop/electron/bootstrap/app-deep-link.ts`：`isAppDeepLinkCandidate()` / `parseDeclaredAppDeepLink()` 走 `manifest-registry` 的 `resolveDeclaredProtocolRoute(hostname)`，**能力可以自己声明协议路由 + `paramsSchema`**，校验通过后由 `dispatchAppAction(capabilityId, params)` 派发给对应能力。**[代码]**

**为什么重要**：
- A4 说的"回调地址为特定 Schema 链接"，在 Synapse 里**已经有正规落点**：注册一条 declared protocol route（例如 `synapse://portal-headless/callback`），带 `paramsSchema` 校验，再由能力接管。不需要新造一套。
- 现有的 `auth` host 是精确匹配的，Portal 的回调**必须换一个 host**，不能挂在 `auth/desktop/callback` 下面。
- 按仓库规则，改动这个注册面要**同步更新 `docs/agents/capability-registry.md`** 的表格、数量和例外说明（见根 `CLAUDE.md`）。

> 补充（D1 已选会话 token，这条更相关）：**"token 出现在 URL 里"在这个产品里已有先例** —— 首页登录信息里的 `shareLogin()` 会生成带 token 的分享链接（`components/portal/layout/index.vue:337-353`）；`newPageWithPlatformAuth(url, params)` 把 `token / tenant-id / module-type` 拼进 `window.open` 的 query（`app/portal/utils/common.js:7-12`，被销售侧多个导出链接使用）；移动端 `/simple/*?token=…&tenant=…` 入口也是既有的（`router/entry.js:17-57`）；Flutter 端小慧调 AI 接口时 token 直接走 query 参数 `c=<token>`。所以 A4 的做法不是新风险，但也意味着**这个产品的凭据泄漏面本来就宽**。

**要你定的问题**：
49. 回调走 **declared protocol route + paramsSchema + 能力 dispatch**（我的建议）/ 新增一条专用路由 / 其他？
50. 回调 URL 里带 token 和租户（A4）—— 是否改成"URL 只带一次性 code，客户端拿 code 去换 token"？（即使产品里已有 token-in-URL 的先例，回调 URL 会进**系统日志、浏览器历史、崩溃报告**，和页面内跳转的暴露面不同）

---

#### H20｜Portal 自己有一个**服务端 AI 编排引擎**，它已经在"用注册接口做事"

**现象**（全部为后端所有，本仓库只有客户端与管理 UI，没有执行器）：

- **技能 = 提示词 + 工具 + 输出契约**。技能节点字段：`nodeType`（1 技能 / 2 模块）、`promptContent`、`modelConfigId`、**`apiIds`（直接指向 openApiRegistry 的 id）**、`cardConfig`（含 `outputFormatJson` 和按钮动作）（`prompt/prompt/utils.js:409-479`）。模块级开关：`isIntentRecognition / isPublish / isAppExclusive / useSystem / useType / typeId`（同文件 `:60-77`）。
- **服务端执行入口有三个**：`POST /admin-api/ai/skill/config/execute`（按 `skillCode` + `context` 跑技能，返回 `{approved, content, variables}`）、`POST /admin-api/ai/pc/chat/chatStream`（SSE；接受 `skillId / modelConfigId / intent / agentOrchestration`，前端用 `response.body.getReader()` 按 `data:` 分帧）、`business-event/*`（事件触发技能，有执行记录 0 待执行/1 执行中/2 成功/3 失败/4 跳过/5 超时，可人工重试）。
- **意图 → 提示词**：意图（中文名 / 英文名 / 含义）绑定一组 `isIntentRecognition=1` 的提示词。
- **前端不做工具调用**：只执行服务端返回的 8 种 action（`pc-route / flow-detail / select-module / side-panel / send-message / tenant-select / tenant-switch / unsupported`）和渲染 `cardNo` 101–118 的输出卡片。**[代码]**

**为什么重要**：SY 的 Portal Headless 与它构成**两条平行的"AI → Portal 操作"通道**：

| | 通道甲（Portal 自己的） | 通道乙（你的设计） |
| --- | --- | --- |
| 入口 | 意图识别 → 技能 → 业务事件 | Synapse skill → SY 服务端 → Headless SDK |
| 工具来源 | `nodes[].apiIds` → openApiRegistry | 扫描 Portal 代码生成的能力目录 |
| 凭据 | 会话 token（浏览器内） | 会话 token（回调取得） |
| 执行记录 | 有（技能执行记录 + 业务事件记录） | 暂无 |

两者会各自沉淀一套"Portal 能力目录 + 权限映射 + 执行记录"，长期分叉。而且通道甲的"能力目录"（openApiRegistry + apiIds）**已经是人工在维护的一份数据**，D2 选择"全部页面"意味着 SY 侧要再生成一份。

**要你定的问题**：
51. SY 的调用入口，是**直接打 Portal 业务 HTTP**（A5 原设计）/ **调 Portal 已有的技能执行入口**（`/admin-api/ai/skill/config/execute`，传 skillCode + context）/ **按场景分**（读类直接打，写类走技能以获得执行记录）？
52. 如果是前者：SY 侧生成的能力目录，与 Portal 已有的技能/接口注册数据，是否要做一次对齐，避免同一个"预定会议室"存在两份定义、两种行为？

---

#### H21｜Portal 仓库里已经躺着一份 2,258 行的"AI 可读 Portal 知识库"

**现象**：`.codex/skills/everything-portal/` 是一个**面向 AI 的项目级 Skill**（设计文档 `docs/superpowers/specs/2026-06-11-everything-portal-skill-design.md`），本身就是为了"让 AI 理解 Portal"而写的：

```
.codex/skills/everything-portal/
  SKILL.md
  references/   project-map / coding-standards / page-development / list-pages /
                routing-and-menu / flow-forms / http-and-module-type / modal /
                dict-and-components / files-import-export / charts / verification …
  scripts/list-route-check.js          (490 行，路由配置检查)
  references/routing/known-route-check-findings.json   (历史问题基线)
  assets/prototype/{list,detail,form,modal}.html
  evals/fixtures/portal-mini/          (一个可跑的迷你 Portal 夹具)
```

其中 `references/http-and-module-type.md`（112 行）已经写清楚了：13 个 HTTP client 各自的 `baseURL` env、返回值差异、以及 `module-type` 的推导规则；`references/routing-and-menu.md`（207 行）写清楚了路由与菜单。**[代码]**

**为什么重要**（对 D2 尤其重要）：

- D2 要"覆盖全部页面"，能力目录必须由 SY 侧生成。**这份知识库就是现成的原料**，而且是人工校对过的，比从 5,352 个 `.vue` 里重新扫一遍可靠。
- `list-route-check.js` + `known-route-check-findings.json` 正是 H8/Q22 想要的"对账 + 显式例外清单"的**先例**：它已经有一套"新 error 才失败、历史 error 记为 known"的机制，可以直接沿用这个范式做菜单↔路由对账。
- 但它的 `LIMITATIONS` 明确写着：**不校验菜单 title、permission、moduleType 或按钮权限一致性**。也就是说 H8 要的那次对账**目前并不存在**，只做了一半（路由放置）。
- 注意这份 Skill 的定位是"帮 AI **改** Portal 代码"，不是"帮 AI **用** Portal"。两者目标不同，但共享同一份"Portal 是什么"的知识。

**要你定的问题**：
53. D2 的能力目录，生成原料用**这份 `.codex` 知识库 + 菜单常量**（我的建议）/ 从 `.vue` 全量静态扫描 / 两者交叉验证？
54. 这份知识库和 SY 侧的能力目录，是要保持"一份源、两种用途"，还是允许分叉？（分叉意味着 Portal 改页面后，两边都要各自更新）

---

### 第四梯队 —— 用起来才会暴露的（第 2 轮补充）

> 前三梯队问的是"结构对不对"。这一梯队问的是"真跑起来会怎样"：AI 怎么找到能力、数据流到哪去了、失败时怎么办、跨团队谁做什么。这些在 D1–D4 定了之后，反而变成最容易出事的地方。

#### H22｜"AI 怎么知道该调哪个页面"比"目录有多少页"更难

**现象**：菜单里 1,077 个 title，走的是内部黑话——"找齐""双赢协议""准入""稳产""高产""记账"。AI 对"薪资审核报表"能对上，对"帮我看看这个月还剩多少预算"对不上任何 title。Portal 自己有一套意图机制（intent：中文名 / 英文名 / 含义 → 绑定 `isIntentRecognition=1` 的提示词），但那是给"大技能"用的，不覆盖页面目录。**[代码]**

**为什么重要**：D2 选了"全部页面"，意味着目录里有 850 条**给人看的名字**。目录本身不是能力，能被找到的目录才是能力。这一环你的录音里完全没提。

**要你定的问题**：
55. 目录条目名用菜单 title 原样，还是另维护一份"AI 可懂的描述 + 别名/同义词"？
56. 别名谁维护、在哪维护（Portal 平台管理员 / SY 侧 / 从 `.codex` 知识库生成）？
57. 检索方式：全量目录塞进上下文（850 页会撑爆）/ 先按业务域缩小再列页面 / 单独的检索接口？
58. 要不要复用 Portal 已有的 intent 数据作为"用户话术 → 能力"的映射？

---

#### H23｜Portal 几乎没有"撤销"

**现象**：全仓搜"回收站"，只有图片列表一处；没有通用软删除/恢复机制，删除类接口就是真删。**[代码]**

**为什么重要**：D4 放开了全部写操作，"删错了"没有回收站可捞。

**要你定的问题**：
59. 哪些操作是**不可逆**的？要不要一份明确清单（删除、审批决定、批量导入、凭证生成、权限与组织变更）？
60. 是否接受"不可逆操作也由 AI 直接触发、无二次确认"？如果不设闸门，有没有其他兜底（操作前把 payload 记进 SY 审计、或强制在对话里向用户播报这次做了什么）？

---

#### H24｜Portal 的敏感数据会流进 Synapse 的对话历史

**现象**：SDK 返回的 `data` 会进入 AI 上下文，也就进入对话记录。Synapse 的会话存在本地 `DataRepository`（`desktop/electron/services/agent-runtime/session-repository.ts` 的 conversations 命名空间），并且有手机端实时中继（`server/src/mobile-live/mobile-live-relay.service.ts`），手机能看电脑上的会话；对话内容本身还要发给第三方模型。**[代码]**

**为什么重要**：Portal 里装着**薪酬、绩效、财务凭证、合同、身份证**这类数据。AI 一查工资条，这段数据同时出现在本地会话记录、模型供应商的请求里、以及可能的手机端。这是整个项目里唯一可能"做完了却不被允许上线"的点，而且你的设计里没有提过任何数据边界。

**要你定的问题**：
61. 哪些 Portal 数据**不允许**进入 AI 上下文（有没有字段级/页面级黑名单）？
62. 进入对话记录的 Portal 数据，要不要限制同步到手机端？
63. 企业是否接受薪酬/绩效数据发往第三方模型？不接受的话是"这些能力不开放"，还是"换本地模型"？

---

#### H25｜服务端调用会不会被 Portal 的网关/风控当成异常流量

**现象**：登录链路里有 `loginDevice`、`deviceCode`、`isNewDevice === 1` 触发短信验证；前端还有设备指纹（`common/utils/finger.js` 注入 FingerprintJS，`deviceCode` 作为登录参数）。请求头固定带 `Accept-Language`、`module-type`、`_t` 时间戳。**[代码]**

**为什么重要**：**一个服务器 IP 拿着用户 token 发请求，流量特征和用户在浏览器里完全不同。** 会不会被 WAF 拦、会不会触发风控告警、要不要加 IP 白名单——这是上线前必须问后端的事，不是出问题才发现的。

**要你定的问题**：
64. Portal 侧要不要为 SY 服务端开 IP 白名单 / 单独配额？
65. 有没有基于设备指纹或 `deviceCode` 的校验会挡住无设备上下文的服务端调用？
66. Portal 对单个 token 的 QPS 有没有限制？SDK 一次调用可能补发十几次基础数据请求（见 F4），峰值要算进去。

---

#### H26｜用户改密码、离职、调岗之后

**现象**：会话 token 无刷新流程；权限来自 `permissionsNotBySystem`，而 A3 设计缓存 10–30 分钟。**[代码]**

**要你定的问题**：
67. 用户改 Portal 密码后，已建立的连接是否失效？（决定"多久必须重连一次"的硬约束）
68. 用户离职/停用后，SY 侧怎么感知？连接器会自己断开吗？
69. 调岗导致权限变化时，30 分钟缓存窗口内 AI 仍按旧权限操作。D4 全放开写之后，这个窗口可能造成**越权写入**——接受吗？

---

#### H27｜"帮别人做事"这个场景没有答案

**现象**：会话 token 和私人令牌都是**用户自己**的凭据。企业里最常见的 AI 诉求却是"帮我给张三订个会议室""帮我看下李四这个月的绩效"。**[推断]**

**要你定的问题**：
70. AI 只能以连接者本人身份操作 —— 这符合预期吗？
71. 需不需要"代他人操作"？（需要的话是另一套授权模型，Portal 侧对应的是转办/委托）
72. 一个 SY 账号能连几个 Portal 账号？能不能连别人的（助理连领导）？

---

#### H28｜多会话并发与状态竞争

**现象**：Synapse 支持多个 Agent 会话并行。它们共用同一份 SDK 会话缓存，也可能同时对同一租户写数据。Portal 前端本来是**单标签页**语义，靠人自己避免并发冲突。**[推断]**

**要你定的问题**：
73. 多个会话同时用同一 Portal 用户的能力，SDK 侧要不要串行化？
74. 两个会话同时改同一条记录怎么办？（无头下没有"用户自己会避免"这个约束）
75. 一个会话的写操作弄脏了缓存，要不要主动失效？

---

#### H29｜失败语义要定义到"AI 该怎么做"

**现象**：错误码是三组不统一的数组 `[401, 10001, 1002015001]` / `[401, 6001]` / `[401]`；业务失败统一是 `ret !== 'SUCCESS'` + `code` + `msg`，而 `msg` 是写给**人**看的中文。**[代码]**

**为什么重要**：A6 的 `llm` 字段价值全在这里——"这类错误可以重试、那类要换参数、这类必须告诉用户"的分类**现在不存在**，也没人负责维护。

**要你定的问题**：
76. 错误分类谁维护：后端逐接口标注 / SY 侧一张映射表 / 让模型自己判断？
77. 典型业务失败分别期望 AI 做什么：余额不足 / 审批已被人处理 / 数据已被删除 / 无权限？
78. 网络超时 + 写操作：重试还是不重试？（H11 幂等的具体化，D4 下必须答）

---

#### H30｜时间与格式

**要你定的问题**：
79. AI 说"明天下午三点"，谁解析成 Portal 要的格式——SDK 还是 SY 侧 skill？
80. Portal 各接口的日期格式是否统一（`YYYY-MM-DD HH:mm:ss`？时间戳？）不统一时是 SDK 归一化还是交给模型？
81. 时区基准用服务器还是用户？"今天"按哪个算？

---

#### H31｜这个项目 Portal 侧到底要做多少事

**现象**：按已决策，Portal 侧至少要做：① 新的鉴权回调路由（含版本校验与本地密钥校验）② 暴露可机器比对的版本标识 ③ 可能的风控白名单 ④ 若采纳 H12/H20，还要加来源头与技能执行入口。**[推断]**

**为什么重要**：跨团队排期通常是这类项目最大的风险，而且它决定了"什么时候能开始"。

**要你定的问题**：
82. 这份"Portal 侧工作清单"谁确认、谁排期？
83. Portal 侧改动能否独立小版本发版，还是必须等某个大版本（当前线在 4.6.3.22）？
84. 验收标准是什么？谁签字？

---

#### H32｜灰度与关闭开关

**要你定的问题**：
85. 能不能按用户/租户灰度？（AI 写错数据的概率不为零，D4 下没有人工闸门）
86. 出问题时能不能**一键关闭 AI 的写能力**，而不必回滚整个版本？
87. 谁有权按这个开关？

---

#### H33｜拿你自己的例子走一遍，缺口立刻显形——而且它其实走不通

"使用 Portal 帮我预定会议室"这一句，逐环节拆开后，缺的东西比抽象讨论时多得多：

| 环节 | 现在有没有答案 |
| --- | --- |
| AI 怎么知道"会议室"对应哪个页面能力 | H22，无 |
| 这个能力要哪些参数（时间、时长、人数、楼层） | 目录要不要带参数契约，无 |
| 参数从用户话里抽不全时怎么办 | 无 |
| **审批人由谁选** | ~~无——而且现在是硬拦截，见 H34~~ → **对会议室这条流程不成立，见本节末的实测更正** |
| "该时段已占用"由谁判断 | 前端判了两遍，服务端是否兜底未知 |
| 提交前要不要回显将要提交的内容 | 无 |
| 怎么判断提交成功了 | `ret`/`code`/`msg` 可用，但看 `msg` 还是 `code` 未定 |
| 结果要不要写进对话、能不能到手机 | H24，无 |
| 用户在浏览器/手机上同时做同一件事 | H28，无 |

会议室这个页面的实际代码路径（`app/portal/views/simple/hr/form/033/page/pc/edit/`）：

1. `formRef.validate()` 前端校验；
2. `POST /admin-api/hr/meeting-application/getRequiredStartUserSelectTasks`，把提交数据发过去问"需要哪些人选择"；
3. **人在弹窗里挑审批人**，合并成 `startUserSelectAssignees`；
4. `POST /admin-api/hr/meeting-application/create`。

第 3 步是硬拦截：`common/libs/flow-form/start-user-select.js:117-135` 的 `finalize()` 在每个必需任务没有有效选择时会**抛错**，`select-tasks.js:212-223` 的 `buildStartUserSelectAssignees` 同样抛错。全仓 78 处调用、49 个文件用这个控制器。**[代码]**

另外时段冲突在两处前端代码里各判了一遍（`meeting-room-booking-modal.vue` 的 `isSlotBooked` / `checkTimeRangeHasBooked`），`confirmSingleRange` 还要处理 `:00 → 24:00` 的边界。服务端是否二次校验，前端看不出来。**[代码]**

> **2026-09-20 实测更正**：我在本节断言"预定会议室走不通，因为要人挑审批人"。**这条不成立，至少对这个流程不成立。** 在测试环境用 bsk 打开该表单并点「查看审批流程」，实际流程链是：
>
> ```text
> 发起流程 → 姚淼鑫（发起人）→ 流程结束
> ```
>
> **该流程没有任何审批节点**，也就没有 `START_USER_SELECT` 任务，服务端 `validateStartUserSelectAssignees` 会直接放行（见 F14）。所以"会议室预定"这条线**可以完整无头执行**，卡点不在这里。
> 但页面自己也提示了"实际审批流程可能会根据填写内容变化"，所以 SDK 在提交前仍应查一次需要哪些审批人节点（F14 的通用接口），而不是假定为空。**H34 的审批人闸门对某些流程是真的，但不是这条。**

**要你定的问题**：
88. 能力目录里每个能力要不要带**参数契约**（参数名、类型、必填、示例）？谁生成、从哪生成？
89. 参数不全时，SDK 返回"缺什么"让 AI 反问用户，还是 AI 直接问？
90. **审批人（`startUserSelectAssignees`）由谁定？** AI 按规则推断 / SDK 返回"需要选审批人"让 AI 问用户 / 请后端提供默认审批人 / 这类页面第一期不开放写？（**注**：这个问法假定了"会议室这条流程需要选人"——实测 0 个审批节点，见本节末的更正。问题的通用形态仍然有效，但会议室不是它的例子。）
91. 提交前要不要在对话里**回显将要提交的内容**？—— 这是 D4（不设人工闸门）下成本最低的一层兜底，我建议至少加这一条。

---

#### H34｜已有两类操作在**物理上无法**无头执行（不是"要不要"的问题）

**一、短信验证闸门。** `app/portal/hooks/hr/useSensitiveAction.js` + `app/portal/utils/hr/sensitive/useSensitiveAction.js`（两份几乎相同的实现）给一批敏感操作套了短信验证：先 `/sys/sms/send`（`templateId: '17709'`）发验证码到用户手机，再 `/sys/sms/checkSms` 校验，只有 `ret === 'SUCCESS'` 才放行真正的写操作（`app/portal/hooks/hr/components/verify.vue:84-122`）。覆盖的删除操作包括：**组织类型、法人、岗位、岗位类型、薪资等级、报表配置、员工、外部员工、组织关系变更**，涉及 12 个文件。**[代码]**

**为什么重要**：短信验证码是**发给用户手机**的。SY 服务端既拿不到、也不该拿。这意味着**这批删除操作在任何设计下都无法由 AI 直接完成**，除非：
- 让用户自己在 SY 客户端输验证码（等于把闸门搬到了 SY 侧），或
- 请 Portal 后端为服务端调用豁免这个校验（那等于取消这道安全门），或
- 这批能力不开放。

**后端已查证（见 F20），这条的前提要修正**：**短信闸门在后端根本不存在**。`SendSmsController` 的 `templateId` 参数被接收但从未使用；**没有任何后端端点要求或校验短信码**，没有任何拦截器读那缓存；`hr_sensitive` 表只是通知接收人名单，不是"敏感操作注册表"。**直接调删除接口就能绕过它。**

所以 D5（"把闸门搬到 SY 客户端"）的真实含义是：**这道门目前只存在于浏览器里**。

**已决策（D16）：让 SDK 遵守前端浏览器的逻辑。** SDK 复刻浏览器那一套——调 `/sys/sms/send` 触发发码 → 用户在手机上看到码 → 用户把码给 AI → SDK 调 `/sys/sms/checkSms` 校验 → 通过后继续。实现上完全可行（这两个接口就是普通业务接口，SDK 照调即可）。

**这道门的正确定位是"用户知情同意闸门"，不是安全边界** —— 它挡的是"AI 未经用户同意就执行删除"，挡不住"有人绕过浏览器直接调接口"。按这个定位，D16 是合理的；只要不把它当成安全机制来宣传即可。

**一个实现细节要留意**：验证码会经过对话（进入 AI 上下文、可能落进会话记录）。4 位码、且 `checkSms` 只做一次比对，风险很低，但设计里要写明"验证码只用于当次校验、不得写入日志/会话持久内容"。

**二、审批人选择闸门。** 见 H33 第 3 步，全仓 78 处。**但"预定会议室"要从事例里划掉**——该流程实测 0 个 `START_USER_SELECT` 节点、`tasks` 恒为空，见 H33 的实测更正。这条闸门**对别的流程仍然是真的**（判据在 BPMN 模型里，F14）。

**要你定的问题**：
92. 短信闸门下的那批删除动作，走哪条路：**移到 SY 客户端让用户输验证码**（我的建议）/ 让后端豁免 / 不开放？
93. 审批人选择：**AI 推断** / **返回给用户让用户选** / **后端给默认值** / 不开放？（⚠️ **注**："这正是预定会议室卡住的地方"已被 H33 的实测更正推翻——该流程 0 个审批节点。问题的通用形态仍然有效，会议室不是它的例子。）
94. 除了这两类，**还有哪些能力是"必须有人的输入才能完成"**？要不要把全部页面按"可无头 / 需人介入 / 不可无头"过一遍筛？

---

#### H35｜参数要分类型，长选项集是单独一类（D6 落地）

**你的口径（D6）**：2–3 项的小枚举直接列给 AI；上百上千项的大选项集（候选审批人、组织树、人员）不一次性返回，**先问用户关键字**，用户不知道就先列前几级或给出选项，AI 拿关键字去搜索匹配；列表查询若无需搜索条件即可查就直接返回，若必须从树形结构或长选项里选就走"先问用户"。

**代码依据**（这几类参数在 Portal 里确实各有各的形态）：

| 类型 | Portal 里的形态 | 代码位置 |
| --- | --- | --- |
| 长选项（人） | 审批人选择器，必须人工从列表挑 | `common/libs/flow-form/start-user-select.js`、`select-tasks.js`（78 处调用） |
| 树形（组织/岗位） | 树形选择组件，异步加载 | `components/portal/hxr/tree-select/role-organization-tree/`、`portal/finance/tree-select/post-tree/` |
| 字典枚举 | 两套字典（HR / 平台），页面启动时全量拉取 | `BASE_DATA_REGISTRY` 的 `dict-hr` / `dict-platform` |
| 小枚举 | 页面内常量 / `options`（全仓 101 处组件内 options、265 处 UPPER_CASE 枚举） | 见发现记录 §8 |

**为什么重要**：这是 D6 直接产生的新设计单元。参数契约里如果只写"必填/类型"，AI 面对"审批人"这种参数只能瞎猜；写成"搜索型 + 提供搜索入口"，AI 才知道自己该先问用户拿关键字。

**要你定的问题**：
95. 参数契约里要不要给每个参数标**参数类型**：`枚举(直接给)` / `搜索型(长选项，需关键字)` / `树型(可逐级展开)` / `自由文本` / `日期`？谁来标、从哪标（后端接口标注 / SY 侧从组件用法推断 / 人工维护）？
96. 搜索型参数的**搜索接口**从哪来？（Portal 页面用的是某个下拉组件的异步搜索接口）SDK 要把这个搜索能力也暴露给 AI，还是只负责把用户给的关键字回传？
97. 树形参数"先列前几级"可行；**扁平的长列表（审批人上千个）列不了前几级**，这时返回什么？"请给一个关键字"？
98. 关键字搜不到 / 搜出多个同名人时怎么办？
99. 这条规则要不要写成 SDK 的**统一行为**（所有搜索型参数走同一套协议），还是每个能力自己描述？

> ⚠️ 实测校正（2026-09-20，**这条是本设计里最典型的"说了但没做"**）：
>
> **Q96「搜索型参数的搜索接口从哪来」在协议里曾经是一句空头承诺。** `describe()` 的 `consumption` 里写着"用 `lookup` 指定的能力查候选"，但 `lookup` 字段**根本不存在**——7 个能力、24 个参数，`lookup` 出现 **0 次**；`next` / `related` 也没有一条边指向候选来源。黑盒评测把它判为**阻断级**缺口（`docs/eval-report.md` G2），真实模型**独立复现**了同一堵墙：它走到 `prepare` 前、指出了要什么、写出了正确的下游链路，但没有任何一条边告诉它去哪查，只能回头问用户，并点名引用了这条 warning（`docs/eval-model-report.md` N1）。
>
> **现在已修**（时间线要读清楚，别再当成"仍然坏着"）：
> - 参数上有了结构化的 `lookup: { capabilityId, keywordParam }`（`src/capabilities/types.ts`），`describe()` 把它展开成 `{capabilityId, keywordParam, hint}`（`src/catalog/types.ts`、`src/catalog/describe.ts`）；
> - `consumption` 里那句空头承诺**改成只在真有 `lookup` 时出现**，没有时给的是明确的"需要人工确认"（`src/catalog/describe.ts:44`）；
> - `CAPABILITY_LINKS` 补了边，`related` 新增 `upstream` / `downstream`（`src/catalog/links.ts`）；
> - 新增 `validate().lookups` 自检，人工维护的表有死链会直接报出来（`src/catalog/index.ts`）。
>
> 会议室这条线的实际取值：`prepare` / `submit` 的 `meetingRoomId` → `meeting-room-list`（关键字 `name`）；`submit` 的 `startUserSelectAssignees` → `meeting-user-search`（关键字 `keyword`）。
>
> **仍未答的是 Q97 / Q98**（扁平长列表列不了前几级时返回什么、搜不到或重名怎么办），以及"其余长选项的搜索接口是哪些"（见 §5）。

---

#### H36｜"能力目录"的真实构成比"850 个页面"复杂得多

**实测**（菜单与路由两侧独立枚举、互相校验）：

| 项 | 数量 |
| --- | --- |
| 目录节点（含分组） / 叶子页面 | 1,150 / **928**（生产与测试环境 913，DEV 工具箱 15） |
| iframe 嵌入外部系统的叶子 | **38**（6 个流程引擎 + 32 个产品 SaaS） |
| 外部 `url:` 链接 | **0**（外部系统只能通过那 38 个 iframe 到达） |
| **title 重复** | **126 个值、314 个节点**（"数据分析"×9、"订单管理"×7、"养殖预案"×6…） |
| path（去掉 query 后） | 880 个唯一值，其中 **11 条路径来自 2 个菜单项**（产品模块交叉引用，靠 query 区分） |
| 菜单路径 → 路由文件 | **878 / 880 = 99.8%** 对得上；2 条对不上（疑似改名残留） |
| **路由里有、菜单里没有** | **2,757 条**（静态 2,125 + 动态 632）；其中 `/simple/**` 流程表单 **582** 条 |
| 带 `permission` 的菜单节点 | 912 / 929 |
| 不是菜单节点但**是路由**的弹窗组件 | 79 |

**对 D8 的三个直接后果**：

1. **能力目录不能拿 title 当 key。** 126 个 title 重复、314 个节点共用名字。AI 说"我要看数据分析"，指哪一个？必须有唯一标识——菜单路径可以，但 11 条路径重复，得用 `path + query` 或后端给 ID。**[代码]**
2. **"我要提一个流程"这条路径，菜单覆盖不到。** 流程表单共 **112 个 ID**（`/simple/<模块>/form/<NNN>`，其中 4 个是模板），**全部不在菜单树里**——而"提流程"恰恰是 AI 最自然的用法。这 112 个表单的业务名现在只散落在三处：`<业务名>.md` 文件名（113 个）、`app/portal/utils/flow.js:4-14` 的 9 条白名单注释、`sale/trade/claim-apply/constants.js` 的 3 条理赔类型映射。**前端侧没有中央注册表。** **[代码]**
   > **D9 已解决这条**，但不是靠"补一份注册表"：菜单里本来就有「发起流程」页（`/dashboard/flow/task/create/list`，`menus/hr.js:247`），它调 `GET /bpm/process-definition/create-list?suspensionState=1&processType=…`，返回按用户过滤的分组流程定义，每项带 `name / key / formCustomCreatePath / formType / baseUrl / category`，然后按这些字段跳转对应表单（`views/dashboard/hr/flow/task/create/list/index.vue:214-240`）。**所以流程一层不在目录里，而在"发起流程"这个页面的能力里**——这正是 D9 说的"逐级往下"。
3. **D8 的"仅侧边栏可见菜单"确实是全量 928 的子集**，且只能由后端按当前用户算——912 个节点带 `permission`，还要过租户开通系统与 `all_menus_type_match`。你的口径在这里是对的，难点在于"后端有没有现成的接口能算出这个子集"。**[代码]**

**要你定的问题**：
100. 112 个流程表单要不要进能力目录？进的话它们的业务名从哪来（`.md` 文件名 / 新建一份注册表 / 后端是否已有表单清单接口）？
101. 2,757 条非菜单路由（`/dashboard/platform` 413、`/dashboard/product` 318、`/dashboard/home` 70、`/dashboard/chat` 52…）算不算"能力"？如果算，D2 的"全部页面"实际是 **3,635 条路由**，不是 928 个菜单页——口径要统一。
102. 能力目录的唯一标识用什么？（菜单路径 / 路径+query / 后端给 ID）
103. 那 38 个 iframe 叶子虽然 D3 排除了外部系统，但它们在**菜单里、用户看得到**。目录里怎么表示（排除 / 标为"需跳转" / 只列出不可执行）？
104. D8 说"服务端返回目前所有的菜单 + 路由推荐"——**这个接口现在有吗？** 还是需要新做？（Portal 现有的 `permissionsNotBySystem` 只返回权限码，不返回菜单）
105. "路由推荐"（什么话术 → 走哪个路由）由谁维护、在哪维护？和 Portal 已有的 `intent` 是什么关系（复用还是另起一套）？

---

### 第五梯队 —— 阶段①②落地时才会碰到的（第 6 轮补充）

#### H37｜多环境让"版本对齐"从"比一个号"变成"比环境"

**现象**：你说的三种环境，实测仓库里有 **6 种构建模式、5 个不同后端域名**：

| 构建模式 | `VITE_ZHDJ_PLATFORM_API` |
| --- | --- |
| dev（`.env`） | `https://biz-api-dev.wodecorp.cn` |
| test（`.env.build.test`） | `https://biz-api-test.wodecorp.cn` |
| test02 | `https://biz-api-test7082.wodecorp.cn` |
| test11 | `https://bizapi-sjz.wodecorp.cn` |
| beta | `https://biz-api-test.wodecorp.cn`（与 test 同域） |
| prod | `https://biz-api.wodecorp.cn` |

**[代码]**

**为什么重要**：A7 说"SDK 版本与 Portal 网页正式版严格相等"。但 SDK 现在要能连多个环境，**每个环境部署的 Portal 版本可能不同**，dev 上甚至可能跑着未发布的代码。所以"版本"其实是两件事：**SDK 构建时依据的那份源码版本**，和**运行时目标环境实际部署的版本**。D13（构建时烘入）只固定了前者。

**要你定的问题**：
126. SDK 支持哪几个环境？全部 6 个 / 只 test + prod（我建议）/ 只 prod？
127. 连到某个环境时，要不要校验该环境部署的 Portal 版本与 SDK 构建依据的一致？（F18 的 `build.json` 的 `buildId` 现成可用）
128. dev 环境要不要支持？它可能跑未发布代码，用它做基准会得出错误契约。

---

#### H38｜"逐字段一致"需要一个基准来源，而且要能随 Portal 发版更新

**现象**：D20 把验收标准定为"与浏览器请求逐字段一致"，这需要一份"正确答案"。可选来源：① AI 驱动浏览器抓真实请求（D21 提到的手法）；② 人工抓包录入；③ 从代码静态推导——但 D20 的存在恰恰因为静态推导不可靠。

**为什么重要**：这直接决定阶段②的测试资产从哪来、以及**Portal 每次发版后谁来更新基准**。如果基准更新是人工的，它会很快烂掉。

**要你定的问题**：
129. 基准请求从哪来：**AI 驱动浏览器自动抓取**（与我建议，与 D21 一致）/ 人工录入 / 混合？
130. 基准存在哪？（仓库里的 JSON 快照 / 数据库 / 生成物）
131. Portal 发版后，基准怎么更新？自动重抓 / 人工确认 / 不更新（测试转红后人工修）？
132. 逐字段比对的范围：URL + method + header（含 module-type）+ query + body 全比 / 只比 URL + body / 其他？

---

#### H39｜AI 浏览器辅助构建的工作量，需要先估算

**现象**：D21 说"做某个页面时，让 AI 打开该页面的真实浏览器页面，了解真实布局与真实操作步骤"。而目录里有 **928 个菜单页 + 2,757 条非菜单路由**（见 H36）。

**为什么重要**：如果每个页面都要 AI 开一次浏览器，那是 900–3,600 次浏览器会话的工作量。这不一定是问题（可以只对要开放的能力做），但**必须先划范围**，否则阶段①会变成无底洞。

**要你定的问题**：
133. 阶段① 的目录生成，覆盖多少页面？（先做 1 个业务域验证方法 / 全部菜单页 / 按需逐个加）
134. 哪些页面值得走"AI 看真实页面"这条路？（全部 / 只有写操作 / 只有参数复杂的）
135. AI 看页面的产出物是什么形态？（能力定义 JSON / 参数契约 / 操作步骤文档 / 全都要）
136. 这套"AI 看页面生成能力"的流程本身，要不要也做成可重复执行的工具（Portal 发版后可重跑）？

---

### 第六梯队 —— 阶段① 执行前必须先定的（第 7 轮补充）

#### H40｜"页面唯一参考清单"的口径没定，而它决定待办列表有多长

**现象**：D24 说清单"可能会非常长"，但**包含哪些页面**目前有三种可能，长度差近 4 倍：

| 口径 | 条数 | 里面有什么 |
| --- | --- | --- |
| 只算菜单叶子 | **928** | 用户在侧边栏点得到的页面（生产/test 913） |
| 菜单 + 流程表单 | 928 + 112 | 加上"发起流程"能到的表单 |
| 全部可达路由 | **3,635** | 另含 2,757 条没有菜单项的路由：首页卡片 70、聊天小慧组件 52、平台管理 413、产品 318… 里面大量是弹窗式路由、小工具、内部页 |

而且无论取哪个口径，都还有 **38 个 iframe 叶子**（6 个流程引擎 + 32 个产品 SaaS）落在菜单里，要单独决定怎么处理。

**要你定的问题**：
137. 清单口径取哪个？（我建议**菜单叶子 928 + 流程表单**，把 2,757 条非菜单路由排除在阶段①之外）
138. 那 38 个 iframe 叶子要不要进清单？（如果进，它们无法被 SDK 执行，只能标"需跳转"）
139. 清单的每一行包含哪些字段？（建议：唯一 ID、菜单路径、页面名、所属业务域、module-type、权限码、是否 iframe、是否写操作、优先级、状态）
140. **唯一 ID 用什么？**（菜单路径唯一性好但有 11 条重复；建议 `path + query` 归一化后加短哈希）
141. 推进顺序按什么排？（菜单顺序 / 业务域 / 业务价值 / 使用频率）
142. 清单放在哪、用什么形式维护？（Markdown 表格 / CSV / JSON / issue 列表）

---

#### H41｜"一个页面做完了"需要验收标准

**现象**：D26 定了四件套产出物，但没有定义"做完"。逐页推进的工作流里，如果没有完成定义（Definition of Done），清单会变成一份永远做不完的列表。

**要你定的问题**：
143. 一个页面的 DoD 是什么？（四件套齐 + 基准回归通过 + 在清单上勾掉 / 还要人工复核）
144. 只读页面也要走完四件套吗？（D25 说所有页面都走，但只读页面的"操作步骤文档"价值不高）
145. 谁来判断"这个页面做完了"——你本人 / AI 自检 / 自动化测试通过即可？
146. 做完之后 Portal 发版改了页面怎么办？（重跑 / 标红 / 不管）

---

#### H42｜量级估算：按 D24+D25，阶段①是一个几百小时量级的工程

**说明**：这不是反对，是把账算清楚，好让你决定清单口径和推进节奏。

按已决策的口径推算：

| 项 | 数 |
| --- | --- |
| 待办页面（菜单叶子口径） | 928 |
| 每个页面的动作 | AI 开真实页面 + 抓基准请求 + 写能力定义 + 写参数契约 + 写操作步骤文档 + 回归 |
| 按"每天推进 4 个"算 | **约 230 个工作日**（≈ 11 个月） |
| 按"每天推进 10 个"算 | 约 93 个工作日（≈ 4.5 个月） |

**几个可能改变量级的因素**：

- 大量页面是同一个模板（renren 的 `useListPageModule` 覆盖 1,092 个 `.vue`、`useFormPageModule` 覆盖 369 个）。**如果 SDK 能识别"这是一类标准列表页"，就可以批量生成**，而不是逐页做。这会改变数量级。
  > ⚠️ **已实测（2026-09-20）：会改变，但远不到上面这两行暗示的程度。** 255 个"纯声明式"列表页里只有 **136 个能全自动产出（53%）**，115 个需人补、4 个产不出；即便把 208 个短 `customLoad` 也算成可批量，也只有 **136/463 = 29%**。所以本节表格里"约 230 个工作日"那个量级**没有被批量生成打下来多少**。出处：§1d 更正块、`src/capabilities/generated/batch-report.json`。
- 反过来，923 个列表页用 `customLoad` 逃生口（见发现记录 §4.5），模板化的部分比看上去少。
- 365 个表单页里有 321 个用 `customSubmit`，同理。

**要你定的问题**：
147. 阶段① 的目标是"覆盖全部页面"，还是"验证方法 + 覆盖一条完整业务线"？
148. 要不要先做一次**模板聚类**——把 928 个页面按"用的是哪套框架（renren 标准列表 / 自定义 / 声明式表单 / 其他）"分组，先看能不能批量生成？（我强烈建议这一步放在逐个推进之前）
149. 如果是批量生成，逐页"AI 看真实页面"的价值会下降（变成抽检）——接受吗？
150. 阶段① 有没有时间预算？（有的话我按预算反推清单口径）

---

## 4. 问题速览（答复回填在这张表）

| Q | 问题 | 我的建议 | 你的答复 |
| --- | --- | --- | --- |
| Q1 | 私人令牌能否调用普通业务接口？ | — | **不能，只能调登记过的开放接口（F6）；本条关闭** |
| Q2 | 目标是"全部页面"还是"登记过的开放接口"？ | 开放接口白名单 | **全部页面（D2）——且只有会话 token 能支撑，见 F6** |
| Q3 | 还需要 A4 的浏览器回调吗？ | 仅作体验优化 | **要，作为唯一凭据通道（D1）** |
| Q4 | `module-type` 由谁决定？ | 能力声明为主、反查校验 | **已实现**：按页面推导（`resolveModuleType(pagePath)`），能力可覆盖（`src/context/module-type.ts`） |
| Q5 | 反查不到 module-type 时怎么办？ | 拒绝调用 | **已被 D34 取代**：不是拒绝，是"与浏览器一致——不发这个头"。见 H2 实测校正 |
| Q6 | 第一期范围是否含 iframe/BPM/独立域名系统？ | 全排除 | **只做 Portal 主后端（D3）** |
| Q7 | BPM 审批类写操作是否放开？ | 只读 | **不适用（BPM 已出范围，D3）** |
| Q8 | 写操作分级规则？ | 只读/低风险/高风险三档 | **不分级，全部放开（D4）** |
| Q9 | 能力是否标注风险档位？谁来标？ | 是，平台管理员在注册表标 | **不适用（D4）** |
| Q10 | 需要"现算业务规则"的写页面怎么办？ | 第一期不开放 | **升级为必答（D4 后）** |
| Q11 | 缓存键？多租户怎么切？ | `(用户,凭据,tenantId,lang)` | |
| Q12 | 缓存内容？ | 复用 `BASE_DATA_REGISTRY` | |
| Q13 | TTL 是空闲还是绝对过期？ | 两者取先到，默认 30 分钟 | |
| Q14 | 缓存上限与淘汰策略？ | LRU + 内存水位 | |
| Q15 | 凭据失效时 SDK 的行为？ | 明确失败 + 可操作错误码 | |
| Q16 | 要不要保活/预检？ | 要 | |
| Q17 | 断开连接器时是否吊销 Portal 令牌？ | 要（仅私人令牌可吊销） | |
| Q18 | 版本是否拆成"产品版本 + 契约版本"？ | 拆 | |
| Q19 | SDK 版本权威来源？ | 部署产物的 `build.json` | |
| Q20 | 版本不匹配时？ | 降级只读 + 告知 | |
| Q21 | 能力目录以菜单还是路由为准？ | 菜单常量 | |
| Q22 | 接受"对账 + 显式例外清单"吗？ | 接受 | |
| Q23 | iframe/外链节点怎么表示？ | 排除或标记"需跳转" | |
| Q24 | 能力可见性怎么算？ | 用户权限 ∩ 令牌 scope | |
| Q25 | 勾选权限分组时能否预览页面能力？ | 需要 | |
| Q26 | 第一期是否排除所有文件能力？ | 排除 | |
| Q27 | 下载只给 URL 还是服务端持 OSS 密钥？ | 只给后端签发 URL | |
| Q28 | 前端生成的 docx/PDF 导出怎么办？ | 不支持 / 后端补接口 | |
| Q29 | 写能力是否必带 `requestId` 去重？ | 必带，短窗口去重 | |
| Q30 | 是否推动后端支持幂等键？ | 是 | |
| Q31 | 请求是否带来源标识头供 Portal 审计？ | 带 | |
| Q32 | 需要后端配合记录吗？ | 先只加头 | |
| Q33 | `llm` 字段加在真实包络 `{ret,code,msg,data}` 顶层？ | 是 | |
| Q34 | 是否需要第三层目录接口？ | 需要 | |
| Q35 | 列表是否有行数上限与字段裁剪？ | 有 | |
| Q36 | `-llm` 文档谁来生成？ | 从菜单+契约+字典生成 | |
| Q37 | 凭据存客户端还是服务端？ | 客户端存、服务端内存持有 | |
| Q38 | 多设备是否共用一份凭据？ | 否，各自连接 | |
| Q39 | 服务端重启后是否要重新授权？ | 否（凭据在客户端） | |
| Q40 | 走现有 Connector 概念还是新概念？ | 新概念 | |
| Q41 | Connector 的非目标是逐条重决还是特例？ | 逐条重决 | |
| Q42 | "服务端下发 SDK 版本"做成通用目录还是专用配置？ | 专用配置起步 | |
| Q43 | SY 服务端是单实例吗？ | 需你确认 | |
| Q44 | 多实例时缓存怎么办？ | 粘性路由优先 | |
| Q45 | 回调前加用户可见确认？ | 加 | |
| Q46 | 临时密钥的有效期与绑定？ | 一次性、5 分钟、绑 SY 用户 | |
| Q47 | 路由与鉴权风格用哪套？ | 沿用 SY `/api/open/v1/**` + Bearer + scope | |
| Q48 | 能力登记放哪？ | 需要先答 Q2 | |
| Q49 | 回调走 declared protocol route？ | 是 | |
| Q50 | 回调 URL 带直通 token 还是带一次性 code？ | 一次性 code | |
| Q51 | 调用入口直接打业务 HTTP 还是走 Portal 技能执行？ | 读类直打、写类走技能 | |
| Q52 | SY 能力目录与 Portal 技能/接口注册是否对齐？ | 要 | |
| Q53 | 能力目录的生成原料用哪个？ | `.codex` 知识库 + 菜单常量 | |
| Q54 | 知识库与能力目录是否允许分叉？ | 一份源、两种用途 | |
| Q55 | 目录条目名用菜单 title 还是另做 AI 可懂描述？ | 另做一层 | |
| Q56 | 别名谁维护、在哪维护？ | 服务端（配合 D8） | |
| Q57 | 检索方式分层还是全量？ | 分层：域 → 页面 → 能力 | |
| Q58 | 是否复用 Portal 的 intent 做话术映射？ | 见 Q105 | |
| Q61–63 | 敏感数据边界 | — | **不做限制，全部可读（D7）** |
| Q64 | 要不要给 SY 服务端开 IP 白名单？ | 要，先问后端 | |
| Q65 | 设备指纹/deviceCode 会挡住服务端调用吗？ | 需后端确认 | |
| Q66 | 单 token 有无 QPS 限制？ | 需后端确认 | |
| Q67 | 改 Portal 密码后连接是否失效？ | 需后端确认 | |
| Q68 | 离职/停用后 SY 侧怎么感知？ | 需要机制 | |
| Q69 | 调岗后 30 分钟缓存窗口的越权写入接受吗？ | 缩短写操作的缓存 | |
| Q70–72 | "帮别人做事"的边界 | 只能以本人身份 | |
| Q73–75 | 多会话并发怎么处理？ | 写操作串行化 | |
| Q76 | 错误分类谁维护？ | 后端标注为主 | |
| Q77 | 典型业务失败期望 AI 怎么做？ | 需逐类定义 | |
| Q78 | 超时 + 写操作重试吗？ | 不重试，返回明确状态 | |
| Q79–81 | 时间与日期格式谁处理？ | SDK 归一化 | |
| Q82 | Portal 侧工作清单谁确认排期？ | 需跨团队确认 | |
| Q83 | Portal 侧能否独立小版本发版？ | 需确认 | |
| Q84 | 验收标准与签字人？ | 需确认 | |
| Q85–87 | 灰度与一键关闭写能力？ | 要有 | |
| Q88 | 能力是否带参数契约？ | 要 | |
| Q89 | 参数不全时怎么办？ | 返回缺什么，AI 问用户 | |
| Q90 | 审批人由谁定？ | **见 Q93** | |
| Q91 | 提交前回显将要提交的内容？ | 建议加（低成本兜底） | |
| Q92 | 短信闸门走哪条路？ | **搬到 SY 客户端（D5）** | |
| Q93 | 审批人等长选项参数怎么办？ | **按 D6：先问用户关键字** | **按 D6 落地**（`lookup`，见 H35）；**会议室这条流程实测 0 个审批节点**，见 H33 更正 |
| Q94 | 要不要把全部页面按"可无头/需人介入"筛一遍？ | 要 | |
| Q95 | 参数是否标类型（枚举/搜索型/树型/自由文本）？ | 要 | |
| Q96 | 搜索型参数的搜索接口从哪来？ | 需定义 | **已落地（2026-09-20）**：参数上的 `lookup{capabilityId,keywordParam}`；会议室用 `meeting-room-list` / `meeting-user-search`。见 H35 |
| Q97 | 扁平长列表列不了前几级时返回什么？ | "请给一个关键字" | |
| Q98 | 关键字搜不到/重名怎么办？ | 需定义 | |
| Q99 | 搜索型参数是否走统一协议？ | 是 | |
| Q100 | 112 个流程表单要不要进目录？ | **作废——由 D9 解决**：走「发起流程」页的 `create-list` 能力，不预先平铺 | |
| Q101 | 2,757 条非菜单路由算不算能力？ | 需统一口径 | |
| Q102 | 能力目录的唯一标识用什么？ | 路径 + query，或后端 ID | |
| Q103 | 38 个 iframe 叶子怎么表示？ | 列出但标"需跳转" | |
| Q104 | "返回菜单 + 路由推荐"的接口现在有吗？ | 疑似要新做 | **已有（F18）**：`GET /admin-api/sys/menu/nav?project=`，按当前用户过滤；只有"路由推荐"要 SDK 自己生成。**上面"疑似要新做"这个猜测是错的** |
| Q105 | 路由推荐谁维护？和 intent 什么关系？ | **作废——D11 规定由 SDK 提供** | |
| Q106 | SDK 下发的目录是构建时固化还是运行时实时拉？ | — | **构建时烘入（D13）；但可见性是运行时数据，见 F9** |
| Q107 | "路由推荐"在无头下的语义是什么？ | 非导航 | **作废——D14：是 SDK 内部的抽象域概念** |
| Q108 | 一次「帮我订会议室」允许几轮往返？ | — | **不设上限，优先保准确（D15）** |
| Q109 | 目录/推荐的更新频率与缓存策略？ | 需定（D13 下 = SDK 发版节奏） | |
| Q110 | 静态结构 vs 运行时可见性，分界画在哪？ | 结构烘入 SDK，可见性实时取（F9） | |
| Q111 | 要不要推动后端把"令牌类失败"拆成可区分的错误码？ | 要，否则 H29 的 `llm` 做不出来 | |
| Q112 | 幂等键是否照抄 BPM 的 `client_request_id` 范式？ | 是 | |
| Q113 | 短信闸门要不要在后端重建？ | **要，否则 D5 保护不了任何东西（F20）** | |
| Q114 | 凭据失效无法即时生效（改密不失效、停用不即时、最坏 7 天），接受吗？ | 建议缩短 JWT 有效期或加撤销 | |
| Q115 | `module-type` 必须显式传且传对，同意吗？ | **同意（F19：不传会放大数据范围）** | |
| Q116 | 不传 `tenant-id` 会被静默选错租户，是否强制必传？ | 强制必传（F26） | |
| Q117 | 能力可见性直接用 `/sys/menu/nav` 的菜单树？ | 是（F18，接口现成） | |
| Q118 | 后端已有大量 `@DataScope` 数据范围，SDK 是否需要感知？ | 需要——`module-type` 传错就等于越权取数 | |
| Q113 | 短信闸门怎么办？ | — | **SDK 复刻浏览器逻辑（D16）；定位是同意闸门** |
| Q114 | 凭据生命周期接受吗？ | — | **接受现状（D17）** |
| Q48 | 能力登记放哪？ | — | **作废（D18）：与后端无关，由前端代码推导** |
| Q47 | 路由前缀用哪套？ | — | **推迟到阶段 ④（D18）** |
| Q119 | 独立包用什么语言/形态？（TS/npm 包 / 与 SY 后端同构 / 独立服务） | 需定——影响阶段 ① 的起点 | |
| Q120 | 独立包放哪个仓库、目录？ | 需定 | |
| Q121 | 包的自动化测试跑在什么环境上？（真实 Portal 环境 + 真实账号 / mock / 两者都要） | 需定——这是阶段 ② 的核心 | |
| Q122 | 测试用例从哪来？（对着前端行为 / 对着真实接口响应 / 从页面能力反推） | 需定 | |
| Q123 | 包的版本号与 Portal 版本的关系？（D13 构建时烘入 ⇒ 每次 Portal 发版都要重建？） | 回到 A7/Q18–Q20 | |
| Q124 | 阶段 ①②③ 之间的验收标准分别是什么？ | 需定 | |
| Q125 | 阶段 ① 的交付物是什么形态？（可运行的包 / 包 + 演示脚本 / 包 + 报告） | 需定 | |
| Q19 | 独立包形态？ | — | **TypeScript 包（D19）** |
| Q20 | "做对了"的标准？ | — | **与浏览器请求逐字段一致（D20）** |
| Q21 | 测试环境？ | — | **SDK 接 BaseURL 参数，测试连测试环境（D21）** |
| Q22 | 阶段①起点？ | — | **先做目录生成（D22）** |
| Q126 | SDK 支持哪几个环境？ | 建议 test + prod | |
| Q127 | 连环境时要校验该环境的 Portal 版本吗？ | 要（用 `build.json` 的 buildId） | |
| Q128 | dev 环境要不要支持？ | 建议不要，会得出错误契约 | |
| Q129 | 基准请求从哪来？ | AI 驱动浏览器自动抓取 | |
| Q130 | 基准存在哪？ | 仓库里的 JSON 快照 | |
| Q131 | Portal 发版后基准怎么更新？ | 自动重抓 + 人工确认差异 | |
| Q132 | 逐字段比对的范围？ | URL+method+header+query+body 全比 | |
| Q133 | 阶段① 目录覆盖多少页面？ | 先做 1 个业务域验证方法 | |
| Q134 | 哪些页面走"AI 看真实页面"？ | 只有写操作 + 参数复杂的 | |
| Q135 | AI 看页面的产出物形态？ | 能力定义 JSON + 参数契约 | |
| Q136 | "AI 看页面"的流程要不要工具化？ | 要，否则发版后无法重跑 | |
| Q126 | SDK 支持哪几个环境？ | — | **三环境；BaseURL 写在测试用例里，SDK 不绑环境（D23）** |
| Q133 | 阶段① 怎么推进？ | — | **先出页面唯一参考清单，再逐行推进（D24）** |
| Q134 | 哪些页面走"AI 看真实页面"？ | — | **所有页面（D25）** |
| Q135 | 产出物形态？ | — | **四件套：能力定义 + 参数契约 + 基准请求 + 操作步骤文档（D26）** |
| Q137 | 清单口径取哪个？ | 菜单叶子 928 + 流程表单 | |
| Q138 | 38 个 iframe 叶子进清单吗？ | 进，标"需跳转" | |
| Q139 | 清单每行有哪些字段？ | ID/路径/页名/业务域/module-type/权限/是否 iframe/是否写/优先级/状态 | |
| Q140 | 唯一 ID 用什么？ | path+query 归一化 + 短哈希 | |
| Q141 | 推进顺序按什么排？ | 建议先按框架分层，再按业务域 | |
| Q142 | 清单放哪、什么形式维护？ | JSON + 可勾选视图 | |
| Q143 | 一个页面的 DoD？ | 四件套齐 + 回归通过 + 勾掉 | |
| Q144 | 只读页面也走完四件套吗？ | 可省操作步骤文档 | |
| Q145 | 谁判断"做完了"？ | 自动化通过 + 人工抽检 | |
| Q146 | 发版改了页面怎么办？ | 标红重跑 | |
| Q147 | 阶段① 目标是全覆盖还是验证方法？ | 建议先验证方法 | |
| Q148 | 要不要先做模板聚类再逐页推进？ | **强烈建议要先做** | |
| Q149 | 批量生成时逐页 AI 看页面降为抽检，接受吗？ | 建议接受 | **不接受——仍逐页全看（D31）**；且实测证明批量产出的 `auto` 能力**也必须抽样做浏览器基准**，不能免检（§1d 更正块） |
| Q150 | 阶段① 有时间预算吗？ | — | **暂无硬预算，质量为先（D30）** |
| Q149 | 批量后还逐页看吗？ | — | **仍然逐页全看（D31）** |
| Q147 | 阶段① 目标？ | — | **验证方法 + 跑通一条业务线（D29）** |
| Q148 | 先聚类？ | — | **已执行，结果见 §1d（D27）** |
| Q137 | 清单口径？ | — | **菜单叶子 + 流程表单（D28），已交付 1,019 行（D33）** |
| Q32 | 阶段① 起始业务线？ | — | **会议室预定（D32）** |
| Q151 | 那 42% 算不出 `module-type` 的页面怎么办？ | 遵守浏览器=不发头，接受更宽的数据范围；或请 Portal 补规则 | **已决策（D34）：遵守浏览器=不发头**，接受那份更宽的并集；补规则是 Portal 侧的后续项 |
| Q152 | 清单字段够不够？要不要加"module-type 覆盖"标记列？ | 建议加 | |
| Q153 | 9 条解析不到路由的菜单项怎么处理？ | 标记为"疑似菜单残留"，单独确认 | |
| Q154 | 49 条 iframe 叶子在清单里怎么标状态？ | 标"需跳转"，不参与逐页推进 | |
| Q155 | 下一步是否开始做会议室那条线（第 228 行起）？ | 建议是 | **已做（D36）**：读链路 `1568e3f` → 写链路 `784830b` → 浏览器逐字段基准 + 回归 `64f9283`。现状见 §1c |

---

## 5b. 下一步：会议室那条线（D36）

> ✅ **2026-09-20 回填：这条线已经做完了，"下一步"这个词过期了。** 读链路：真实环境冒烟对 `https://biz-api-test.wodecorp.cn` 读到 8 条会议室（`smoke/read-meeting-rooms.mjs`）→ 写链路：`784830b` 端到端验证（含 `prepare → submit → cancel`，提交的单已撤销）→ 浏览器逐字段基准 + 回归：`64f9283`。本节保留的是**当时的计划**，其中"审批人"那一项已被实测推翻（见下面第 3 条）。现状与证据见 §1c 与 `docs/roadmap.json`。

清单第 228 行起，涉及的对象与已知的后端接口：

| 对象 | 前端位置 | 后端接口（已在设计文档 §2b 查证） |
| --- | --- | --- |
| 会议室管理（列表） | `/dashboard/meeting-room/list` → `views/dashboard/hr/meeting-room/list.vue` | `/hr/meeting-room/{create,update,delete/{id},get,page,update-status/{id}}`；用 `MeetingRoomSaveReqVO{id,name,authorizedOrgId}` |
| 会议室预定表单 | `/simple/hr/form/033`（流程表单，走「发起流程」） | `/hr/meeting-application/create`；`MeetingApplicationSaveReqVO{meetingName,meetingRoomId,startTime,endTime,attendeeCount,attendees,startUserSelectAssignees}` |
| 发起流程列表 | `/dashboard/flow/task/create/list` | `GET /bpm/process-definition/create-list?suspensionState=1&processType=…` |
| 需要选审批人 | 同上的弹窗 | `POST /hr/meeting-application/getRequiredStartUserSelectTasks`；服务端校验 `validateStartUserSelectAssignees`（`1_009_004_003`…`_007`）。**实测该流程返回 0 个节点**（见 H33 更正）——接口形态仍然要复刻，因为"要不要选人"随填写内容变化 |
| 时段占用查询 | 预定弹窗里 | `GET /hr/meeting-application/meeting-room-usage?date=`（按调用者 organizationId 过滤）。**注**：本行原先写成 `/hr/meeting-room-usage`，那是错的；§1c 记过这个 bug，这里回填正确的路径（实测源码：`views/simple/hr/form/033/page/pc/edit/index.vue:283` 与 `…/components/meeting-room-booking-modal.vue:146`） |

这条线**同时覆盖所有已知难点**（D32 选它的理由）：

1. 目录下钻：菜单 → 发起流程页 → 能力 → 流程表单
2. 参数契约：`meetingRoomId` 是**搜索型/树型**参数（D6/H35 的第一个真实用例）
3. 审批人：`startUserSelectAssignees` 是**服务端强校验的必填长选项**（F14/Q93）——⚠️ **实测更正（2026-09-20）**：会议室这条流程的审批链是 `发起流程 → 发起人 → 流程结束`，**零个审批节点**、`tasks` 恒为空（见 H33 更正）。它仍是 F14 那个接口的真实用例，但**不是这条业务线的卡点**；这条线之所以仍要保留它，是因为"要不要选人"随填写内容变化。
4. 服务端校验：时段冲突在服务端也判（F16），业务失败报 `500`
5. 写操作全放开（D4）下的第一条真实写入链路

**建议的四件套产出**（以 `会议室预定` 这个能力为例）：

```text
capability.json      能力定义（唯一 ID、页面路径、module-type、权限码、风险档位）
params.json          参数契约（含参数类型：搜索型 / 日期 / 整数）
baseline/*.json      逐字段基准请求（浏览器抓取，D20）
steps.md             操作步骤文档（D26）
```

### D20 / D21 的工具已经有了

D21 说的"AI 的浏览器控制能力"不需要新建：本机已装 **`bsk` 0.3.0**（`~/.local/bin/bsk`）+ `browser-skill`（`~/.claude/skills/browser-skill/`），它的定位就是**操作用户已登录的 Chromium**——访问、读页面、填表单、点流程、回归测试。

这正好解决两个问题：

1. **登录问题**：抓基准必须处于已登录状态，而 `bsk` 直接复用用户当前浏览器的登录态，不需要 SDK 自己处理 Portal 登录。
2. **逐页推进的可持续性**：它是可重复执行的，符合 Q136（"AI 看页面的流程要不要工具化"）。

所以阶段① 的工具链是：`bsk`（开页面 + 抓请求 + 观察操作）→ 生成器（产出四件套与清单）→ 回归（重放基准请求，逐字段比对）。

---

## 5. 待补充（下一轮）

**已解决（后端仓库查证后关闭）**

- ~~按当前用户返回菜单的接口~~ → **已有**：`GET /admin-api/sys/menu/nav`（F18）
- ~~私人令牌能否调普通接口~~ → **不能，是白名单**（F6）
- ~~流程表单有没有后端清单~~ → 走 `create-list`，且后端已有表单白名单（F13）
- ~~服务端会不会被设备指纹/WAF 挡~~ → **不会，后端没有这些**（F25）
- ~~改密码/停用对 token 的影响~~ → **改密码不失效；停用请求时不重查，最坏 7 天**（F21）
- ~~BPM 是不是另一个系统~~ → **接口在同一个后端，只有设计器 UI 是外部 SPA**（F12）

**仍需后端/平台配合（不是查代码能解决的）**

- **短信闸门要在后端重建**，否则 D5 只是形同虚设（F20/Q113）。这是唯一一项**必须 Portal 后端改造**的
- 会员/组织/审批人等长选项的**搜索接口**是哪些、能否复用于"搜索型参数"（Q96）——**部分已答（2026-09-20）**：会议室这条线已用 `meeting-room-list` + `meeting-user-search` 接上 `lookup`（见 H35 的实测校正）；**其余长选项仍未逐个确认**，属未复核。
- 令牌类失败是否拆分错误码（Q111）；业务失败 500 是否细分（F16）
- 幂等键是否按 BPM 的 `client_request_id` 范式推广（F10/Q112）
- 会话 token 能否加撤销（F21/Q114）

- **会话 token 与私人令牌在网关层是不是同一套校验**。这是 D1 + D2 的前提：如果会话 token 能走通全部 `/admin-api`，D1/D2 成立；如果网关对两者分治，"回调拿会话 token + 覆盖全部页面"就需要后端开口子。**优先级最高。**
- `POST /admin-api/ai/skill/config/execute` 的完整入参/出参契约、权限要求、可执行的技能范围（决定 H20/Q51）
- `POST /admin-api/ai/pc/chat/chatStream` 的 SSE 分帧契约与 `agentOrchestration` 语义
- 第 2 节 F2 的开放接口注册表**当前登记了多少条、覆盖哪些业务域**（决定"人工登记"这条路实际走了多远）
- Portal 侧技能（`tip-template` / `ai/skill/config`）当前有多少个、`apiIds` 平均绑多少个接口
- Portal 侧业务事件（business-event）当前绑了哪些事件、有没有写操作类事件

**需要你确认**

- SY 服务端是单实例还是多实例（决定 H16）
- Synapse 连接器概念是否要为远程凭据型连接器扩展边界（决定 H15/Q40）
- 会话 token 过期后，用户重新授权的完整路径（D1 下这是唯一恢复手段）

**已经出范围、暂不追**

- BPM iframe 是否有可直连的 HTTP 接口（D3 已排除 BPM）
- 18 个 axios 实例里"不同 host"的那一批的 token 语义（D3 已排除；同 host 不同前缀的 4 个见 §1d 更正块末尾的范围问题）

---

## 补记（2026-09-21）：D8 的落地口径——可见性收敛是**显式入口**，不是默认行为

`src/catalog/visibility.ts` 从写完起就一直没接进门面，原因是它需要「这个用户能看到的菜单树」，
而**此前没有任何能力拿得到菜单树**。基础能力 `base-menu-nav`（`getMenuNav()`）补上了这个前提，
2026-09-21 过夜推进时把这条链接了起来。落地口径如下，理由逐条记在此处：

1. **`portal.catalog` 保持全量，不自动过滤。** 三个候选口径都试过：
   - **构造期过滤不可行**：菜单要打网络，而 `createCatalog` 是同步纯函数；多用户门面里
     「这个用户」在构造期根本不存在（目录是**服务级共享**的静态数据）。
   - **每次 `describe`/`search` 自动过滤更糟**：目录 API 会全变 async；且直接违反第 15 条
     （菜单树**不是权限裁决**——实测存在「不在该账号菜单里、但该能力可调」的情形），
     自动过滤会把能用的能力藏起来；多用户里更是在服务级共享对象上做 per-用户 过滤 = **串用户**。
   - **最终口径**：另给一个显式入口 `visibleCatalog({ project })`（单用户 `portal.visibleCatalog()`、
     多用户 `forSession(...).visibleCatalog()`），返回 `{ catalog, report, applied, note }` ——
     一份只含可见页面的目录**视图** + 一份可解释的报告。
2. **收敛 ≠ 拦住。** 被收敛掉的能力**仍然可调**；`describe()` 在视图里没命中时会明说这一点。
   这正对应第 15 条的定位：「下发面收敛」，不是权限裁决。
3. **失败关闭。** 菜单取不到、或菜单树被截断（超过 `maxNodes`），一律抛 `MenuVisibilityUnavailableError`，
   **不降级成全量**——降级等于静默放大下发面（与第 1 条同一种病，调用方看不出自己没被收窄过）。
   显式退路有两条：直接用 `portal.catalog`，或传 `onUnavailable: 'unfiltered'`（会如实给出
   `applied: false` 与说明）。`project` 参数非法**不**降级——吞掉它等于静默不过滤，且在网络之前就挡掉。

权威实现说明在 `src/catalog/README.md`；接线测试在 `test/visibility-wiring.test.ts`。
`src/catalog/visibility.ts` 本身**一行未改**——它是纯函数，缺的一直只是「谁来喂它菜单树」。

### 2026-09-22 A6/D14 补充：只读 schema 下钻和真实候选链

SDK 描述在既有 describe/describePage/describeMethod 之外新增 `catalog.describeSchema(id)`。当前 `contract-template-content` 由单一源码表返回完整可序列化结构，不让 AI 翻仓库；能力输入契约给出此调用路径。返回独立副本，未知 ID 明确失败。复杂模板仍只保存，未增加审批提交行为。

候选缺口以只读 contractSupport 方法和真实 invoke 注册补齐，按源页面绑定 module-type/HTTP实例。合成目录页不增加未开发页面覆盖；实际使用 source ID 的字段映射、数组选择、付款月份转换和分支限制由同一 AI 契约返回。动态响应存在不代表所有字段业务语义已知，尚无来源的枚举/单位和权限回显歧义仍保留 gaps，complete 门禁继续拒绝。

本轮仅修改 SDK，参考 Web/Java 固定检出，离线验证不宣称部署实测。模型申请前后端冲突按当前 Java 可执行状态收敛，旧“忽略”不自动解释为驳回；一键配置的两步写入不是事务，失败回执保留第一步创建 ID。公共 SDK 请求补足个人流速租户0，并保留“企业租户内个人规则不在当前已支持分支”的界限。

### 2026-09-22 A6/D14 范围校正：与 Portal 页面功能性和可见性对齐

用户明确“如果一个数据前端没有显示，那SDK也不需要提供；SDK只负责和Portal页面功能性和可见性对齐”。据此，AI说明解释页面展示和动作必需的数据，不要求解释后端返回的所有扩展字段。隐藏ID等若参与页面动作仍须说明来源与传递；无关原始透传仅保留兼容，不作为新增功能或AI消费目标。

页面原值展示且未标单位时，SDK按相同口径交付，不猜单位，也不把额外单位研究当作完成门槛。权限保存按页面回执完成，页面没有的跨账号效果证明或完整子树恢复不另作验收条件；开放接口页面已有的isBound删除保护仍须对齐。模型页面可见“忽略”动作与Java状态协议冲突属于页面功能差距，不再要求用户决定这个按钮是否应该存在。源码复核不等于线上实测；网络不确定性与真实错误仍必须如实说明。

### 2026-09-23 范围收敛与会话缓存落地校正

本轮将“菜单是能力边界，接口所属系统只是实现信息”落成机器可审计的范围模型：`generated/portal-scope.json` 从 Portal 菜单源生成，保留门户的智能助手、个人用量、待办事项、系统设置，平台的人工智能、平台设置，以及人力全部菜单；当前得到 295 个保留节点，其中 289 个可调用页面、6 个外部承载节点。财务、资产、生产、采购、销售等名称出现在门户系统设置或平台公共设置下时仍按菜单保留，只有范围外菜单入口被排除。

`generated/scope-audit.json` / `docs/scope-audit.md` 固定“菜单 → 路由源码 → 动作/支撑接口 → capability → AI 契约/文档/测试”的逐页矩阵。流程表单等从保留菜单实际可达但没有独立菜单叶子的页面记录为 `dependencyOnly`；审计中的 `registered-unverified` 与 `functionalCoverage=unverified` 只表示静态接线和离线证据已命中，不替代浏览器基准或真实环境写入回查。

会话公共缓存的有效身份维度是 SY 用户、凭据身份指纹、Portal 租户、语言和非敏感权限上下文；原始凭据不进入 store key、事件或诊断。会话级与能力级请求均 single-flight，凭据轮换、身份维度变化、显式失效、TTL/LRU 淘汰和受影响写操作成功后按精确规则失效。写操作失效只在请求成功后发生，读 POST 不因 HTTP 动词被误判，基础缓存使用 generation 防止旧的在途响应在失效后回填。单用户门面与 `createPortalServer` 共享同一失效证据表，但缓存仍依附于长期复用的 SDK 实例/SessionStore。

本轮 Portal 与 Java 检出未能从内部远端完成 `pull --ff-only`，因此范围与页面动作结论以本地固定分支的静态源码为依据；所有真实环境读 smoke 以及写能力 `prepare → submit → verify → cancel/cleanup` 均需在可用凭据和测试数据条件下另行执行，不能把离线测试或静态审计称为线上验证。
