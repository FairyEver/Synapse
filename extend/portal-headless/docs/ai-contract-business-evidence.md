# 当前范围说明

用户最新要求以对应Portal页面功能性和可见性为边界。以下先前逐轮调查为历史证据；课程完整DTO/宝典扩展、原值单位研究不再构成当前页面契约要求。当前SDK字段、缺口与验收以 [页面范围复核](ai-contract-audit/semantic-blockers.md) 和 [总账](ai-contract-audit/README.md) 为准。

# 业务模块 AI 契约补齐清单

## 盘点边界与证据等级

- 基线：当前实际注册定义与 `sdkPathOf` 执行绑定交集中的 22 个门面模块，共 **93 能力 / 57 页面**；不使用历史覆盖数，不新增页面。
- 公开未注册门面：**11 方法**，通过 `catalog.describeMethod(sdkPath)` 描述，不能把门面路径当 capabilityId 传给 invoke。
- 权威说明：`src/catalog/contracts-business.ts`；页面文档为 SDK 实际 describe 输出的同步摘录。共同参数协议按实际 payload 复用，状态及业务区别单独定义。
- 前端固定分支 `test/portal/main` @ `74c5f2f0e5`、后端固定分支 `test/test` @ `dcb3f360194`，由主代理先核分支并 `pull --ff-only`，本子任务只读。
- 基准与页面文档中的真实请求/冒烟为历史实测；当前执行层、Vue 页面列/转换、Java DTO/SQL/service 为源码核对证据。离线夹具只证明 SDK 行为，不冒充真实线上结果。
- 不重放写入。本批不存在额外真实写记录；历史 CRUD 链与现有基准保留，不把“HTTP 成功”作为业务完成证据。

## 验证结果与反证

- `pnpm exec vitest run test/ai-contract-business.test.ts`：14/14 通过；覆盖 93 项与所有候选/下游绑定闭合、11 未注册方法、关键真实返回形状/状态/上下游映射。
- `pnpm typecheck`、`pnpm build` 通过。全仓检查和 `pnpm run docs` 由主代理统一执行，避免并行生成物混入。
- M1 临时删除 `study-record-list` 的 `list[].startStudyTime`：对应语义测试红；恢复后绿。
- M2 临时将 `base-image-list` 的状态 1 改为“未发布”：状态区分测试红；恢复后绿。
- M3 临时将排班回写 `userIdList` 来源从 `staffCode` 改为 `paramsId`：人员 ID/工号映射测试红；恢复后绿。
- M4 临时将个人分析 realWage 单位从“元”改为“分”：工资单位语义测试红；恢复后绿。
- M5 临时将图文 syncType=1 错套为视频“超市风采视频”：跨资源枚举测试红；恢复后绿。
- 全仓 `pnpm test -- …` 曾误触全量执行，旧 catalog/invoke 断言受并行装配调整影响失败；未修改或放松它们，已告知主代理。

## 关键证据与校正

- CRUD：各模块现有 `baseline/*.browser.json`、`test/{assignment,attendance-shift,attendance-team,base-image,base-management-center,contract-template}*.test.ts` 及页面冒烟。作业返回 ID、合同 create 返回 number / update/remove 返回 true，其余普通写多为空业务回执。组织预检是读、禁用会级联班级；原始 create 与注册防重 create 分开。
- 排班：`attendance-team.ts` 与后端排班关系 DTO；读取 `type=4.paramsId` 是用户 ID，保存 `userIdList` 要工号 `staffCode`。四类成员覆盖写，缺省会清空。
- 学习记录：当前 `education/study/study/list.vue` 显示 `startStudyTime/endStudyTime`，状态字典 `lesson_study_status`。班级统计 invoke 必需 `kind`。
- 学习统计：`StatisticsServiceImpl.lessonStatisticsList` 生成已带 `%` 的字符串；`StudyStudentDao.xml` 对完成课比例乘 100 保留两位小数；智慧蛋鸡四段统计分别捕获错误，结果 null 配套 errors。
- 学习资源：继续核对 StudyCourseListDTO → News/Videos/IMGroupDTO、MediaResourceNewsDto/DiagnosisAntiepidemic 后补齐完整 DTO 字段；嵌套 Object 类型媒体可通过现有 listText/listVideo 实际响应取得，未解释的外部码和时效单位仍明确列为缺口。
- 绩效：`hr/analysis/department/list.vue` 与 `KpiHomepageServiceImpl` 比例已是百分数；`salary-structure/list.vue` 直接追加百分号；树的节点类型在利润、模板、标准、薪资结构之间不同；时间配置 value=键、label=实际值。
- 年度签订配置：`SysDictDataServiceImpl.getYearProtocolConfig` 返回 String 提示，不是对象。
- 流程：待办 task.id 与 processInstance.id 区分；抄送记录 id 不是审批任务 id；模型 processDefinition 为空代表未部署。

## 逐能力验收

“已补齐”指当前已开发接口的说明；“有具体阻塞”不计完成。每项的 `evidence`、`gaps`、完整字段和上下游映射同时由 SDK 返回。所有行均经过实际 describe 路径和执行绑定检查；关键语义夹具与反证覆盖范围见上文，不声称每一字段均实测。

| 能力 | 页面 | 缺口与处理 | 状态 | 证据 | 验证 |
| --- | --- | --- | --- | --- | --- |
| `attendance-archive-sheet-list` | [考勤档案](pages/考勤档案.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-archive-sheet.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-org-search` | [考勤档案](pages/考勤档案.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-archive-sheet.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-list` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-get` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-create` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-update` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-set-status` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `assignment-remove` | [作业管理](pages/作业管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/assignment.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-statistics-list` | [考勤统计](pages/考勤统计.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-shift-list` | [班次管理](pages/班次管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-shift.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-shift-get` | [班次管理](pages/班次管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-shift.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-shift-create` | [班次管理](pages/班次管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-shift.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-shift-update` | [班次管理](pages/班次管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-shift.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-shift-remove` | [班次管理](pages/班次管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-shift.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-list` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-get` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-create` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-update` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-remove` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-schedule-get` | [排班管理](pages/排班管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `attendance-team-schedule-save` | [排班管理](pages/排班管理.md) | 新增岗位/职务的搜索候选未暴露为 SDK 能力；可保留 schedule-get 中既有 paramsId，但新增候选需用户提供已核实 ID，不能猜。 | 有具体阻塞 | src/capabilities/attendance-team.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `backlog-task-examine-list` | [待办事项](pages/待办事项.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/backlog-task-examine.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-list` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-get` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-create` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-create-release` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-update` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-set-status` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-image-remove` | [图库管理](pages/图库管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-image.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-list` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-get` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-check-status` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-create` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-update` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-set-status` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `base-management-center-remove` | [组织结构](pages/组织结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/base-management-center.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `contract-template-list` | [合同模板](pages/合同模板.md) | contract_type 分类树叶子 ID 的候选未接 SDK；现有模板的 typeId 可原样复用，不能凭分类名猜 ID。复杂 content.blocks 已由 catalog.describeSchema('contract-template-content') 返回13个组件、变量与表格结构。 | 有具体阻塞 | src/capabilities/contract-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `contract-template-get` | [合同模板](pages/合同模板.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/contract-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `contract-template-create` | [合同模板](pages/合同模板.md) | contract_type 分类树叶子 ID 的候选未接 SDK；现有模板的 typeId 可原样复用，不能凭分类名猜 ID。复杂 content.blocks 已由 catalog.describeSchema('contract-template-content') 返回13个组件、变量与表格结构。 | 有具体阻塞 | src/capabilities/contract-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `contract-template-update` | [合同模板](pages/合同模板.md) | contract_type 分类树叶子 ID 的候选未接 SDK；现有模板的 typeId 可原样复用，不能凭分类名猜 ID。复杂 content.blocks 已由 catalog.describeSchema('contract-template-content') 返回13个组件、变量与表格结构。 | 有具体阻塞 | src/capabilities/contract-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `contract-template-remove` | [合同模板](pages/合同模板.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/contract-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-course-text-list` | [图文课程](pages/图文课程.md) | Portal可见图文字段、试听及ID关联已解释；分享时效原值展示，不补单位；非页面媒体扩展不属于消费契约。 | 按页面范围已描述 | src/capabilities/study-course.ts；StudyCourseListDTO.java / News.java、MediaResourceNewsDto.java、DiagnosisAntiepidemic.java / StudyCourseServiceImpl.matchResourceByType；app/zhdj-admin/views/dashboard/information/news/components/sync.vue:28,102 / category.vue:64；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-course-video-list` | [视频课程](pages/视频课程.md) | 按Portal原值显示分享时效，不套用外部5..600秒限制；duration与maySee按页面秒展示。 | 按页面范围已描述 | src/capabilities/study-course.ts；StudyCourseListDTO.java / Videos.java、DiagnosisAntiepidemic.java / StudyCourseServiceImpl.matchResourceByType；app/zhdj-admin/views/dashboard/manage/videos-list/components/sync-supermarket-style.vue:189 / sync-smart-veterinarian.vue:243 / list.vue:260,272；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-course-im-list` | [即时通讯课程](pages/即时通讯课程.md) | 状态读外层isDel，禁言读chatRoomMuted，群主姓名/工号与groupId已解释；joinmode/jumpType不属于页面消费契约。 | 按页面范围已描述 | src/capabilities/study-course.ts；StudyCourseListDTO.java / IMGroupDTO.java / StudyCourseServiceImpl.matchResourceByType；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-student-list` | [学员管理](pages/学员管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-student.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-student-check-in-grade` | [学员管理](pages/学员管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-student.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-grade-list` | [班级管理](pages/班级管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-grade.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-grade-search` | [班级管理](pages/班级管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-grade.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-lesson-daily-list` | [晨课堂](pages/晨课堂.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-lesson.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-lesson-weekly-list` | [周课堂](pages/周课堂.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-lesson.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-lesson-monthly-list` | [月课堂](pages/月课堂.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-lesson.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-record-list` | [学习管理](pages/学习管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-record.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-statistics-student-list` | [学员统计](pages/学员统计.md) | 听课时长按Portal原值显示，不加单位或换算；不要求页面以外的上报单位研究。 | 按页面范围已描述 | src/capabilities/study-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-statistics-teacher-list` | [讲师统计](pages/讲师统计.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-statistics-lesson-list` | [班课统计](pages/班课统计.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-statistics-grade-list` | [班级统计](pages/班级统计.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-statistics-learning-summary` | [学习统计](pages/学习统计.md) | 智慧蛋鸡课程候选和组织候选未提供 SDK 等价搜索入口；不能将 study-lesson-* ID 或部门树 ID 推定为等价。 | 有具体阻塞 | src/capabilities/study-statistics.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-teacher-list` | [讲师管理](pages/讲师管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-teacher.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-teacher-level-list` | [讲师类型](pages/讲师类型.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/study-teacher.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `study-appraise-setting-list` | [评价设置](pages/评价设置.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | StudyAppraiseTeacherDTO.java + teacher-appraise-setting/list.vue；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-agreement-change-list` | [状态变更](pages/状态变更.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-agreement.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-month-agreement-list` | [个人月度](pages/个人月度.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-agreement.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-month-agreement-others-list` | [所辖月度](pages/所辖月度.md) | 组织 organizationCode 使用角色组织树 ID；SDK 尚无等价的按角色组织候选入口，不能把 base-dept-search 的部门 ID 当作已验证替代。 | 有具体阻塞 | src/capabilities/perf-agreement.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-year-agreement-list` | [个人年度](pages/个人年度.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-agreement.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-year-agreement-others-list` | [所辖年度](pages/所辖年度.md) | 组织 organizationCode 使用角色组织树 ID；SDK 尚无等价的按角色组织候选入口，不能把 base-dept-search 的部门 ID 当作已验证替代。 | 有具体阻塞 | src/capabilities/perf-agreement.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-year-protocol-config-get` | [个人年度](pages/个人年度.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | SysDictDataController.getYearProtocolConfig / SysDictDataServiceImpl.getYearProtocolConfig；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-formula-definition-list` | [公式配置](pages/公式配置.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-indicator-list` | [指标管理](pages/指标管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-insurance-list` | [五险一金](pages/五险一金.md) | 四项金额按Portal原值显示，不擅加币种/元分或换算；不作为额外页面契约缺口。 | 按页面范围已描述 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-standard-list` | [标准管理](pages/标准管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-protocol-config-read` | [时间节点](pages/时间节点.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-protocol-config-update` | [时间节点](pages/时间节点.md) | 已按 Portal 保存顺序接入日期数组 PUT 与提示对象 PUT；尚未执行真实写入，第二段失败可能造成部分成功且无 requestId | 有具体阻塞 | Portal protocol-configuration/list.vue；SysDictDataController / DTO / service；mock body 测试 | describe/绑定/映射校验通过；真实写入未测 |
| `perf-manage-protocol-deduct-rule-list` | [考核规则](pages/考核规则.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-config.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-protocol-deduct-rule-update` | [考核规则](pages/考核规则.md) | 已按 Portal buildUpdatePayload 接入日期归一、分值格式、固定/累计模式和 version；尚未执行真实写入，后端权限为 hr:performance-config:manage | 有具体阻塞 | Portal protocol-deduct-rule/list.vue、rule-utils.mjs、api.js；KpiProtocolDeductRuleController / UpdateDTO / service；mock body 测试 | describe/绑定/映射校验通过；真实写入未测 |
| `perf-manage-profit-list` | [利润管理](pages/利润管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-salary-structure-list` | [薪资结构](pages/薪资结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-template-content-list` | [模板内容](pages/模板内容.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-template-structure-list` | [模板结构](pages/模板结构.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-study-task-config-get` | [学习任务配置](pages/学习任务配置.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-manage-study-task-config-save` | [学习任务配置](pages/学习任务配置.md) | 已按 Portal 五字段 POST 接入并保留数字精度约束；尚未执行真实写入，前端允许小数而后端 DTO 为 Integer、基线 0 还会被后端拒绝 | 有具体阻塞 | Portal study-task-config/list.vue；KpiMonthProtocolController / DTO / validateConfig；mock body 测试 | describe/绑定/映射校验通过；真实写入未测 |
| `perf-manage-task-type-config-list` | [任务类型配置](pages/任务类型配置.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-manage-template.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-salary-main-list` | [奖励导入](pages/奖励导入.md) | 角色组织树候选未接 SDK，不能用部门树 ID 当 orgIdList。 | 有具体阻塞 | src/capabilities/perf-salary.ts；HrSalaryManagementDTO.getTotalSalary / HrSalaryManagementServiceImpl.saveBaseInfo / KpiMonthProtocolServiceImpl.personalStatistics / hr/analysis/person/list.vue:74；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-salary-adjust-list` | [工资找齐](pages/工资找齐.md) | 角色组织树候选未接 SDK；不能将部门树 ID 推定为此页 orgIdList。 | 有具体阻塞 | src/capabilities/perf-salary.ts；app/portal/views/dashboard/hr/salary/adjust/components/adjust.vue；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-salary-examine-result-list` | [考核导入](pages/考核导入.md) | money单位元；角色组织候选已接入contract-support-role-organization-search。 | 按页面范围已描述 | src/capabilities/perf-salary.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-block-main-list` | [组件管理](pages/组件管理.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-salary.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-analysis-department-summary` | [管理分析](pages/管理分析.md) | 角色组织树候选未暴露；不可用部门树 ID 推定同源，筛选须用户提供已核实的角色组织 ID。 | 有具体阻塞 | src/capabilities/perf-salary.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-analysis-department-self-check` | [管理分析](pages/管理分析.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-salary.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `perf-analysis-person-summary` | [个人分析](pages/个人分析.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/perf-salary.ts；hr/analysis/person/list.vue:74 / hr/manage/salary-structure/salary-structure-config.vue:71 / ProtocolUserDTO.setDetailWage / KpiMonthProtocolServiceImpl.personalStatistics；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-task-create-definitions` | [发起流程](pages/发起流程.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-task.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-task-todo-list` | [待办任务](pages/待办任务.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-task.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-task-done-list` | [已办任务](pages/已办任务.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-task.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-task-copy-list` | [抄送我的](pages/抄送我的.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-task.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-manage-model-list` | [流程模型 双赢协议](pages/流程模型 双赢协议.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-manage.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-manage-ai-review-config-list` | [AI审核配置](pages/AI审核配置.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-manage.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-manage-process-instance-list` | [流程实例](pages/流程实例.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-manage.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |
| `flow-manage-task-list` | [流程任务](pages/流程任务.md) | 用途/边界、参数来源与候选、返回字段/状态、消费/完成/失败、必要上下游已由 SDK 提供 | 已补齐 | src/capabilities/flow-manage.ts；页面既有基准/历史记录 | describe/绑定/映射校验通过 |

## 公开未注册方法

| 门面方法 | 处理 | 限制 |
| --- | --- | --- |
| `sdk.assignment.create` | `catalog.describeMethod('assignment.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.attendanceShift.create` | `catalog.describeMethod('attendanceShift.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.attendanceTeam.create` | `catalog.describeMethod('attendanceTeam.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.baseImage.create` | `catalog.describeMethod('baseImage.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.baseImage.createRelease` | `catalog.describeMethod('baseImage.createRelease')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.baseManagementCenter.create` | `catalog.describeMethod('baseManagementCenter.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。 |
| `sdk.contractTemplate.create` | `catalog.describeMethod('contractTemplate.create')` 返回实际参数与结果契约 | 原始 create 不防重；后端超时后先查询核实，不自动重试。优先使用对应已注册 createIdempotent 入口。；contract_type 分类树叶子 ID 的候选未接 SDK；现有模板的 typeId 可原样复用，不能凭分类名猜 ID。复杂 content.blocks 已由 catalog.describeSchema('contract-template-content') 返回13个组件、变量与表格结构。 |
| `sdk.perfManageConfig.listFormulaScenes` | `catalog.describeMethod('perfManageConfig.listFormulaScenes')` 返回实际参数与结果契约 | 解释返回的数据及对应配置含义即完成；本次不写配置。 |
| `sdk.perfManageConfig.getDictTypeId` | `catalog.describeMethod('perfManageConfig.getDictTypeId')` 返回实际参数与结果契约 | 解释返回的数据及对应配置含义即完成；本次不写配置。 |
| `sdk.perfManageConfig.getProtocolDeductRule` | `catalog.describeMethod('perfManageConfig.getProtocolDeductRule')` 返回实际参数与结果契约 | 解释返回的数据及对应配置含义即完成；本次不写配置。 |
| `sdk.perfManageConfig.listProtocolDeductRuleHistory` | `catalog.describeMethod('perfManageConfig.listProtocolDeductRuleHistory')` 返回实际参数与结果契约 | 解释返回的数据及对应配置含义即完成；本次不写配置。 |

## 继续复核后的可解决与阻塞区分

- 已解决 AI 审核筛选候选：流程模型分页列表 key → processDefinitionKey；先仅按该 key 读取已配规则的 taskDefinitionKey，再进行节点筛选。本能力是查询已有配置，无需枚举尚未配置的全流程节点。
- 已解决 adjustProfit 金额单位：页面调整控件明确 addon-after=元；无需新增实测。
- 已补全三个课程资源 Java DTO 的已知嵌套字段，并提供真实只读 dynamic 下钻；剩余只是外部原码、分享时效单位以及 Object 媒体内容的语义 schema，未以“没有新实测”代替具体问题。
- 确有入口缺失：岗位/职务、合同分类树、智慧蛋鸡课程与组织、角色组织树，均不能把相近来源 ID 视为等价。
- 已解决工资元制：当前薪资结构配置直接显示标准月薪“元”；ProtocolUserDTO.setDetailWage 对比例除以100后形成元制月薪上下限，个人分析 realWage 直接加 ¥。同 HrSalaryManagementDTO.totalSalary 原样被用于个人分析，四个工资分项均同为元；合计还扣签订/评价扣分折现，不能只加四列。
- 已解决图文/视频同步码：智慧蛋鸡现有页面分别定义图文1重磅推荐/2管理精髓/3技术大餐/4红粉鸡汤，视频同步1超市风采/2智慧兽医；两者不能混用。
- 确有口径缺失：学员 studyTime 原样保存 app 上报 studyDuration，DTO与当前Portal页无明确时间单位；视频资源 duration 标秒不能单独证明上报协议同单位。五险一金已核页面、DTO、Excel导入实现和仓库内真实模板（仅“个人/单位社保承担”等表头），仍无单位标识。考核导入 money 已在后续源码算式复核中确认与元制考核工资直接相加，见语义复核。

## 结束复核

最终本组清单为 93 个注册能力、57 页面、11 未注册门面方法；其中 77 个能力说明闭合、16 个能力仍有表内具体阻塞；能力集合由测试从实际 SDK 绑定重新推导并与本模块精确比对，新增/移除会使测试失败。主代理公共契约、执行说明修正与其他模块是并行变化，不属于本子任务文件。最终全仓范围与提交记录由主代理汇总。


## 2026-09-22 固定源码语义补齐

本轮 Web 固定 d3cf56bdc76c73c5eb9252be84b9b39b3900b48e、Java 固定 dcb3f360194e63c33cfd7ef9df4360355ff13533，未修改参考仓库，未新增线上实测。

- SDK 实际补回宝典推荐/发布/媒体类型枚举、topFlag 星级、原媒体四个已消费字段与状态判断分支。
- 视频分享时效由同字段编辑控件明确为秒；图文无单位证据，继续保留缺口。
- 考核结果 money 由元制工资算式确认单位元；不能把考核分数 score 当钱。
- 合同 content 提供 `catalog.describeSchema('contract-template-content')`：13个当前可新增组件、1个历史禁用组件、预定义变量映射、表格/物料数组、版本/顺序/长度约束及 Web/Java 差异；create/update 的 content 参数 source 返回真实入口。
- 两组实际 SDK 输出测试合计18项通过；真实源码变异 money单位、推荐枚举、两方数量和甲方变量键各使语义测试变红，均已恢复。
- 仍缺图文分享时效单位、媒体扩展模型、IM两个远端枚举、studyTime单位、四个保险金额单位。逐项证据与待决策见 [语义复核](ai-contract-audit/semantic-blockers.md)。候选入口另有并行owner负责，本轮不擅自删除其缺口；上方93能力/57页的基线统计不代表并行接线后的全仓结论。
