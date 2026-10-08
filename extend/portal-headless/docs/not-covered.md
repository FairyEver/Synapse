# 长期不覆盖清单

这张表登记**页面会发、但 SDK 已经决定不做**的端点。

它为什么存在：SDK 的覆盖判据是「页面只要有**任一**能力指向它就算完成」，所以按目录树扫一遍页面可达请求、
再跟能力做差集，一定会把下面这些**有意排除**的端点报成「缺口」。2026-09-26 那次盘点就复现过这个问题——
13 条已写明取舍的端点被报成了缺陷。**表内条目不是待办，是结论。**

新增排除必须登记在这里；撤销排除也必须先改这张表。**只写在源码注释或 `docs/pages/*.md` 里不算**——
那些地方审计读不到（同一轮盘点的 37 个页面里，36 个有文档，只有 22 个写了「尚未覆盖」，而且没有任何机器读它）。

---

## 怎么用

做「页面 → 可达请求 → 有无能力」这类差集时，把本表当**过滤器**：

1. 扫出无能力的请求后，先跟本表的「端点」列比对（按路径的静态前缀匹配；`:x` 表示动态段）。
2. 命中就**不进缺口清单**，在报告里单独归为「已登记排除」并引用本表的行。
3. **没命中又判断该排除**的，先加进本表再继续——不要只在报告里口头说明。
4. 表里找不到、又想不出理由的，**按缺口处理**（宁可报出来，也不要静默放过）。

排除只覆盖**端点**。实现层面的取舍（某个参数钉死、不做本地过滤、不预检查）不属于本表。

---

## 一、敏感数据：永不开放

放进去等于把凭据形状送进 AI 上下文。**这一类不接受"顺手补一下"**。

| 端点 | 页面 | 为什么不开放 | 证据 |
| --- | --- | --- | --- |
| `GET/POST /org/organization/getUserByType` | 排班管理（「查看人员」弹窗） | 响应里带 `password` / `password2` / `salt`（**实测**）。而且它在该页只用于把已选的人渲染成行，**不参与任何写载荷**（写载荷的 `userIdList` 来自 `getWorkSchedule` 的 `staffCode`）⇒ 没有它页面动作照样能做完 | `src/capabilities/attendance-team.ts:75-84`、`docs/pages/排班管理.md` |

**同族但方向相反的一条（不是本表条目，别误判）**：`/sys/user/info`、`/sys/user/userNotInGrade`、
`/sys/user/getUserListPage`、`/study/base/studystudent/*` 这些返回 `SysUserDTO` 的接口**是有能力的**，
只是 SDK 在出口处**裁掉了 `password` / `password2` / `salt` 三个键**（逐字段白名单，不是黑名单）。
审计时看到「响应里的 `password2` 没被暴露」**不是缺陷**，是刻意收敛。

- `src/capabilities/business-registration.ts:41-70`、`study-grade.ts:127-131`、`setting-user.ts:215-216`
- `src/capabilities/base-shell.ts:107-121`（`password2` / `salt` 唯一的出口关卡，两个出口各锁一条测试）

---

## 二、长选项 / 无参全量候选：不照抄（D6 / H35）

页面自己会无关键字整页翻，把调用方上下文冲掉。SDK 一律**拒绝照抄**，改成"先问关键字"或"让调用方给 id"。

| 页面发的端点 | 页面怎么发的 | SDK 的替代入口 | 证据 |
| --- | --- | --- | --- |
| `GET /system/user/simple-page` | 流程实例页挂载时**翻 9 页 × 500**（约 4500 人） | `base-user-search`（强制关键字） | `src/capabilities/flow-manage.ts:107` |
| `GET /bpm/category/simple-list` | 流程实例页挂载时**无参全量** | `base-dict-get` 传 `dictType='bpm_model_category'` | `src/capabilities/flow-manage.ts:106`、`flow-task.ts:428` |
| `GET /org/organization/getRoleOrganizationTree` | 按角色返回**一整棵树**（实测约 580–596 KB） | 调用方自备 id | `src/capabilities/perf-salary.ts:258`、`base-sale.ts:154`（记为 #13） |
| `GET /study/grade/studygrade/page?pageSize=99999&pageNo=1` | 学习管理页挂载时全量拉班级 | `study-grade-search`（强制关键字） | `src/capabilities/study-grade.ts:215-216`、`study-record.ts:26-30` |
| `GET /performance/protocol/kpi{month,year}protocol/signatoryByPage` | 协议页挂载时全量拉签订人 | `base-user-search`（强制关键字） | `src/capabilities/perf-agreement.ts:215`、`:288`、`:592` |
| 薪资基础数据的人员全量翻页 | 扣款费用页挂载时 `loopFetch({pageSize:200,maxPages:100})` 循环翻页 | `salary-person-tax-staff-page`（**有界分页**：默认 20 / 上限 200，另给 `organizationId`、`isFilterLeaveStaff` 收窄）。⚠️ **不是"强制关键字"**——该接口的 SQL 根本不拼 `name`，关键字在这条上行不通 | `src/capabilities/salary-person-tax.ts:17`、`:307` |
| 各域页面挂载时的人员/组织全量拉 | 多处，形态相同 | 见上；**结论一致** | `src/capabilities/business-trip-application.ts:1617`、`inventory-asset-stocktaking-config.ts:218`、`vehicle-application.ts:1617` |

**判据不是"这个接口有没有分页"，是"页面有没有在无关键字的情况下把它整份拉下来"。**
有分页但页面固定全量拉（`pageSize=-1` / `99999` / 循环翻页）同样进本类。

---

## 三、明确取舍：不做

不是漏，是取舍。放开会动到真人数据或把具体流程族的枚举写进通用能力。

| 端点 | 页面 | 为什么不做的理由 | 证据 |
| --- | --- | --- | --- |
| `POST /bpm/hr/task/approve`（`type` 落在 KPI 协议族 category 2..7 时） | 待办事项（「办理」弹窗） | 那个分支按 1..6 回写 `kpi_year_protocol` / `kpi_month_protocol` / `kpi_month_protocol_task` 状态、插薪资基础数据、锁评分流程、给签订人发消息。把 `type` 开成参数等于把**具体流程族的枚举**写进一条声称通用的能力里；而且它动的是**真人的 KPI 与薪资数据** | `src/capabilities/task-action.ts:30`、`:46-47` |
| `DELETE /performance/protocol/kpimonthprotocol/{id}` | 个人月度 | 五页写入口**本轮只做读**——这些是**真实业务单据** | `src/capabilities/perf-agreement.ts:148` |
| `DELETE /performance/protocol/kpiyearprotocol/{id}` | 个人年度 | 同上 | 同上 |
| `POST /performance/protocol/kpi{month,year}protocol/changeStatus` | 状态变更 | 同上 | `src/capabilities/perf-agreement.ts:151` |
| `GET /ai-token/quota-usage/daily-progress` | 个人用量 | **上游已废**：后端 `AiTokenQuotaUsageController:85` 把这个映射**整行注释掉了**（该控制器现在只有 `/progress` 与 `/open/progress`），页面调用点还挂着 `silenceOnError: true`——是个**已经失效且没人发现**的调用。按 conventions 第 28 条，注释掉的东西不算数 | `src/capabilities/ai-model.ts:138-142` |

### 关于导出类（非 JSON 接口）

`fileDownloadByStream`（学习管理/学员管理多选后导出）不是 JSON 接口，按流式下载处理，
**不进能力定义**。审计时若扫出这类地址，归本类。
证据：`src/capabilities/study-record.ts:32-35`、`study-student.ts:35-39`。

---

## 四、不在本表、但容易被误报的两类

这两类有专门的规则，不要重复登记：

1. **Portal 里被注释掉的东西**——「能渲染 ≠ 用户能做的事」，见 `conventions.md` 第 28 条。
   审计扫 URL 时会扫到它们，**不要**报成缺口。三种形态都算：
   - **菜单项**（如直播课程 `type=3`，`app/portal/menus/hr.js:299` 整行注释）；
   - **路由页**（晨课堂 / 月课堂的 `record/[id]/item-list.vue`：路由文件在、按 URL 能渲染，
     但页面的按钮打开的是弹窗，全仓没有任何代码 push 到它）；
   - **页面里的动作入口**（合同模板的「撤销」：`list.vue:50` 的按钮整行被 HTML 注释、
     `:161` 的动作列那一行被 JS 注释，`handleRevoke` 只剩定义和注释里的引用）。

   ⚠️ **这一族要与"前后端冲突"分开判**：按钮**活着**、后端缺路由 ⇒ 按第 33 条**交付 + 登记缺口**
   （例：`finance-setting-annual-carryforward-reconcile`）；按钮**被注释掉** ⇒ 按第 28 条**不建**。
   区别只有一条：**用户点不点得到**。

2. **页面声明了但从不发送的接口**（如 `getProfessorList.lay`：`list.vue` 有 `getDataListURL`，
   但同页 `customLoad` 覆写了它，声明永远不触发；又如奖励导入页的那个组织树组件
   被 import 却从未在模板里渲染）。这类要在报告里单列为「死声明」，
   **既不是缺口，也不需要建能力**。
   见 `src/capabilities/study-teacher.ts:62`、`perf-agreement.ts` §五第 3 条、`docs/pages/奖励导入.md`。

---

## ⚠️ 不在这张表里的东西：**未做 ≠ 不做**

这张表只装**已经决定不做**的端点。**「还没做」不是「不做」**——把待办写进本表等于永久把它藏起来，
以后没人会再去碰它。

判据是**当初那句话的语气**：

| 原话 | 属于 | 处置 |
| --- | --- | --- |
| 「不做」「不覆盖」「不照抄」「永不开放」 + 给出理由 | **排除** | 进本表 |
| 「仍未覆盖」「尚未覆盖」「没做」「本轮只做读」 | **待办** | **不进本表**，按缺口排期 |

2026-09-26 我在这一点上错过一次：`study-teacher.ts:52` 的原话是「讲师主体的后续 `.lay` 保存、编辑、
删除以及讲师类型页的增删改**仍未覆盖**」——那是状态不是决定，我却把这 7 条当成「明确不做」放进了排除口径，
并在状态记录里写成「正在补齐」。**代价**：如果照那样登记，剩下 5 条会从所有待办里消失。
是子代理在交付报告里把原文顶回来才发现（`src/capabilities/study-teacher.ts` 文件头现在写着
「它们仍然是**缺口**，不要当成已做」）。

**复核一条排除时，先回去读它当初的原话。**

---

## 状态记录

- **2026-09-26**：本表建立。真正的排除是 **1 条敏感类 + 7 类全量候选 + 5 条取舍**，
  其余一度被我按「明确不做」统计的条目经复核属于**待办**（见上）。
- 同日的缺口盘点：真缺口 **65 条**（原报 70 条，复核可达性后删 5 条——晨/月课堂的学习记录子页
  **用户到不了**、奖励导入页**从不发**那条组织树）。讲师六条写入口已接入讲师能力族，移出本表。
- `.lay` 写入口的落地进度：`insertTeacherLevel.lay` / `updateTeacherLevel.lay` **2026-09-26 已补**；
  `updateTeacherLevelStatus.lay`、`deleteTeacherLevel.lay`、`addProfessorStudy.lay`、
  `updateProfessorStudy.lay`、`updateProfessor.lay` 已补入当前实现；`DELETE /study/base/studyteacher`
  也已接入讲师删除能力。
- **2026-10-08 人力范围修复**：班级启停两步写入、班级学员/组织结构班级独立回查、讲师主体保存/启停/删除、讲师类型启停/删除均已接入；对应 prepare / submit / cancel 契约已登记。取消只丢弃本地草稿，不能撤销已发出的写请求；真实 Portal 环境闭环仍需补测。
