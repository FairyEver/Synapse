# 流程、会议与办理 AI 说明补齐证据（2026-09-22）

当前源码：89 个注册能力、39 个额外公开业务门面、11 份页面四件套。旧 dist 漏了 travel-expense-payee-options，当前源码已注册且绑定；本轮按源码补齐。

主代理已核对固定分支并 pull --ff-only：前端 test/portal/main@74c5f2f0e5、后端 test/test@dcb3f360194。本分工只读参考仓库，不执行真实业务写入。

## 逐能力验收清单

| 能力 | 返回字段数 | 状态 | 证据 |
| --- | ---: | --- | --- |
| meeting-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-form.browser.json（browser） |
| meeting-room-usage | 10 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-write.browser.json（browser） |
| meeting-user-search | 6 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-write.browser.json（browser） |
| meeting-application-prepare | 18 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-write.browser.json（browser） |
| meeting-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-write.browser.json（browser） |
| meeting-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/meeting-application.ts（implementation）；baseline/meeting-application-write.browser.json（browser） |
| general-approval-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| general-approval-user-search | 6 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| general-approval-prepare | 17 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| general-approval-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| general-approval-detail | 8 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser）；GeneralApprovalRespVO@dcb3f360194（reference） |
| general-approval-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| general-approval-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/general-approval.ts（implementation）；baseline/general-approval.browser.json（browser） |
| leave-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-profile | 4 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-types | 2 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-year-rest | 2 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-duration | 1 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-prepare | 26 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-detail | 17 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser）；AttendanceUserRelSaveReqVO@dcb3f360194（reference） |
| leave-application-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| leave-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/leave-application.ts（implementation）；baseline/leave-application.browser.json（browser） |
| vehicle-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-applicant-scope | 5 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-applicant-picker | 21 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-approver-search | 6 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-prepare | 18 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-detail | 15 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser）；VehicleUsageApplicationRespVO@dcb3f360194（reference） |
| vehicle-application-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| vehicle-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/vehicle-application.ts（implementation）；baseline/vehicle-application.browser.json（browser） |
| travel-expense-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-org-options | 5 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-fee-items | 2 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-dict-options | 2 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-area-options | 3 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-projects | 7 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-travelers | 7 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-prepare | 88 | 已接线；具体缺口未验收 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-submit | 1 | 已接线；具体缺口未验收 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-detail | 87 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser）；BpmSpendingApplyTravelRespVO@dcb3f360194（reference）；BpmSpendingApplyTravelEntryRespVO@dcb3f360194（reference） |
| travel-expense-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/travel-expense-application.ts（implementation）；baseline/travel-expense-application.browser.json（browser） |
| travel-expense-payee-options | 16 | 说明已接线并通过离线语义验证 | src/capabilities/travel-expense-application.ts payeeOptions（implementation）；后端 test/test dcb3f360194 FinancePartyOptionRespVO/FinancePartyBankAccountRespVO（reference）；FinancePartyServiceImpl@getPayeeOptions/toSupplierOptionVOList/toCustomerOptionVOList@dcb3f360194（reference） |
| product-design-approval-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-user-search | 6 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-prepare | 17 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-preview | 22 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-detail | 8 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| product-design-approval-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/product-design-approval.ts（implementation）；baseline/product-design-approval.browser.json（browser） |
| overtime-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-current-user | 11 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-approval-chain | 22 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-prepare | 30 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-detail | 15 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser）；OvertimeApplicationRespVO@dcb3f360194（reference） |
| overtime-application-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| overtime-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/overtime-application.ts（implementation）；baseline/overtime-application.browser.json（browser） |
| rest-leave-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-current-user | 11 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-remaining-hours | 1 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-approval-chain | 22 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-prepare | 40 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-detail | 20 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser）；RestLeaveApplicationRespVO@dcb3f360194（reference） |
| rest-leave-application-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| rest-leave-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/rest-leave-application.ts（implementation）；baseline/rest-leave-application.browser.json（browser） |
| business-trip-application-definition | 10 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-current-user | 11 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-approval-chain | 22 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-prepare | 33 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-submit | 1 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-detail | 17 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser）；BusinessTripApplicationRespVO@dcb3f360194（reference） |
| business-trip-application-my-instances | 12 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| business-trip-application-cancel | 1 | SDK说明已接线并离线核对 | src/capabilities/business-trip-application.ts（implementation）；baseline/business-trip-application.browser.json（browser） |
| meeting-room-list | 11 | SDK说明已接线并离线核对 | baseline/meeting-room-page.browser.json（browser）；src/capabilities/meeting-room.ts（implementation）；MeetingRoomRespVO@dcb3f360194（reference） |
| task-action-instance | 10 | SDK说明已接线并离线核对 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser） |
| task-action-workflow-path | 8 | SDK说明已接线并离线核对 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser） |
| task-action-approve | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-reject | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-transfer | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-delegate | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-return-options | 2 | SDK说明已接线并离线核对 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser） |
| task-action-return | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-batch-approve | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |
| task-action-batch-reject | 1 | 说明已接线并通过离线语义验证 | src/capabilities/task-action.ts（implementation）；baseline/task-action.browser.json（browser）；后端 test/test dcb3f360194 的 BpmTaskController.java（reference） |

## 额外公开门面

| 路径 | 用途 | 返回 |
| --- | --- | --- |
| meetingRoom.get | 按已知会议室 ID 获取单个会议室详情。 | 会议室对象 |
| meetingApplication.submit | 会议室预定：提交会议室预定申请 | number（业务单据 ID；SDK 不返回 code/data 包络） |
| generalApproval.submit | 通用审批：提交通用审批（会真的发起流程、给审批人推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| generalApproval.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位通用审批实例。 | 一个流程实例行对象 |
| leaveApplication.submit | 请假申请：提交请假申请（会真的发起流程、给审批人推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| leaveApplication.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位请假申请实例。 | 一个流程实例行对象 |
| vehicleApplication.submit | 用车申请：提交用车申请（会真的发起流程、给审批人推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| vehicleApplication.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位用车申请实例。 | 一个流程实例行对象 |
| travelExpense.submit | 差旅费报销：提交差旅费支出申请（会真的发起流程、给审批人推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| travelExpense.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位差旅费报销实例。 | 一个流程实例行对象 |
| productDesignApproval.submit | 产品设计文档审核：提交产品设计文档审核（会真的发起流程、给审批人推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| productDesignApproval.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位产品设计文档审核实例。 | 一个流程实例行对象 |
| overtimeApplication.submit | 加班申请：提交加班申请（会真的发起流程、给直属上级推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| overtimeApplication.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位加班申请实例。 | 一个流程实例行对象 |
| overtimeApplication.resolveDerivedFields | 加班申请：取得申请人、组织、日期/时长等只读联动值。 | 只读派生字段对象 |
| overtimeApplication.findSelfInApprovalChain | 在预览的 USER_TASK 候选人中查找发起人本人，用于识别自动通过风险。 | SelfApprovalHit[] |
| restLeaveApplication.submit | 调休申请：提交调休申请（会真的发起流程、给直属上级推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| restLeaveApplication.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位调休申请实例。 | 一个流程实例行对象 |
| restLeaveApplication.resolveDerivedFields | 调休申请：取得申请人、组织、日期/时长等只读联动值。 | 只读派生字段对象 |
| restLeaveApplication.findSelfInApprovalChain | 在预览的 USER_TASK 候选人中查找发起人本人，用于识别自动通过风险。 | SelfApprovalHit[] |
| businessTripApplication.submit | 出差申请：提交出差申请（会真的发起流程、给直属上级推待办） | number（业务单据 ID；SDK 不返回 code/data 包络） |
| businessTripApplication.findInstanceByBusinessKey | 按业务 ID 在本人流程中定位出差申请实例。 | 一个流程实例行对象 |
| businessTripApplication.resolveDerivedFields | 出差申请：取得申请人、组织、日期/时长等只读联动值。 | 只读派生字段对象 |
| businessTripApplication.findSelfInApprovalChain | 在预览的 USER_TASK 候选人中查找发起人本人，用于识别自动通过风险。 | SelfApprovalHit[] |
| vehicleApplication.resolveProcessInstanceId | 按用车业务 ID 解析流程实例 ID，优先详情，列表作后备。 | string |
| travelExpense.payeeOptions | 按费用组织或法人范围搜索外部收款客商；返回银行账户用于填写收款信息。 | 外部客商候选[]（SDK 按关键词筛选并截断，不是分页对象） |
| travelExpense.profile | 取得差旅费用发起人身份供自审预览比较。 | {id,realName,organizationId} |
| travelExpense.amount | 按差旅费用明细本地计算含进项税的总金额。 | number |
| travelExpense.previewApprovalChain | 按已构造流程变量预览差旅费审批节点；该方法不做自审拦截。 | 审批节点[] |
| taskAction.myRunningTasks | 获取某流程中当前用户真正可办理的任务。 | WorkflowTask[]（已经展平，且去掉顶层已取消节点） |
| taskAction.currentUserId | 从本人发起流程的 startUser.id 推断当前用户 ID。 | number \| undefined |
| taskAction.searchUsers | 搜索待办转办、委派及抄送用户候选。 | { list: 用户候选[], total: number } |
| taskAction.approve | 通过分配给自己的当前任务；下一节点仍可能继续审批，不能直接认定全流程通过。 | boolean（拆包后的后端成功回执） |
| taskAction.reject | 对分配给自己的当前任务给出不通过意见；业务单据后续状态按流程监听器回写。 | boolean（拆包后的后端成功回执） |
| taskAction.transfer | 转办给另一个用户，我不再持有该任务；与委派后回到本人不同。 | boolean（拆包后的后端成功回执） |
| taskAction.delegate | 委派给另一个用户先处理，处理后回到原持有人；不是转办。 | boolean（拆包后的后端成功回执） |
| taskAction.returnTask | 退回到后端给出的可回退节点；不是取消流程、不是发起人撤回。 | boolean（拆包后的后端成功回执） |
| taskAction.batchApprove | 对选中的本人通用待办批量通过；只处理 category=null 或 8，不能用在 KPI 专属协议任务。 | boolean（拆包后的后端成功回执） |
| taskAction.batchReject | 对选中的本人通用待办批量不通过；必填意见，逐项回查处理结果。 | boolean（拆包后的后端成功回执） |

## 具体调用链阻塞与证据要求

- travel-expense-prepare：项目费用预览缺少后端动态课题负责人变量，当前 SDK 没有取得该完整审批链的调用入口。；预算明细、销售费用关联收入科目、内部收款法人候选未接入；相关可选字段只能使用用户已核对来源的值，不能自行获取或猜 ID。
- travel-expense-submit：项目费用预览缺少后端动态课题负责人变量，当前 SDK 没有取得该完整审批链的调用入口。；预算明细、销售费用关联收入科目、内部收款法人候选未接入；相关可选字段只能使用用户已核对来源的值，不能自行获取或猜 ID。
### 未实测分支（字段及行为已有固定源码契约，非描述结构缺失）

- travel-expense-payee-options：收款字段非空分支缺少真实提交回读证据。
- task-action-approve：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-reject：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-transfer：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-delegate：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-return：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-batch-approve：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。
- task-action-batch-reject：历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。

后端 VO 追加字段是固定源码证据，标明可选/可空，不声称每个字段均在抓包实测出现。未取得的项目审批变量、预算/收入科目/法人候选均如实暴露；不以文案掩盖未接入链路。

## 检查与反证

- 4文件92测试通过：`pnpm exec vitest run test/ai-contract-workflow.test.ts test/catalog.test.ts test/catalog-links.test.ts test/invoke-capabilities.test.ts`。
- `pnpm typecheck` 通过；主代理须最终独立重跑并重建 docs。
- SDK真实输出锁定：会议payload.id=null，请假详情缺失restDay/流程ID，用车staffId与审批userId区别，差旅含税计算及中文流程变量，任务展平和0/1/6状态，原始门面不防重。
- 反证验证器逐项拒绝：删准备不建单说明；任务0改成审批中；用车候选staffId改成userId。恢复/保留原契约后通过。
- 旧回归仅修有独立依据的断言：真实标量`$`、真实字段定位、组织候选及执行层已有order/orderField/requestId；未放松执行绑定必须解析为函数的检查。

### 最终分工复核

- 当前权威运行时对象统计：89 个注册能力、39 个额外公开业务门面描述、994 个返回字段条目、11 份页面文档（含共享字段在不同能力下的独立投影，不是994个去重字段）。
- 扩展回归实测：14 文件、731 测试通过，包括全部本分工流程执行测试、SDK 描述及旧目录/调用绑定回归；`pnpm typecheck` 通过。
- 已实际逐次改坏 `contracts-workflow.ts` 源码运行测试，并在 `finally` 恢复：删除准备不建单说明 → 对应会议准备测试 1 失败；任务0改成审批中 → 对应任务状态测试 1 失败；用车候选staffId改为userId → 对应命名空间测试 1 失败。每次均为 1 failed / 9 passed；全部恢复后上述731项回归通过。
- 未运行任何会写 Git 的命令，提交、公共接线、docs 生成物由主代理负责。

### 映射与附件再复核

- 所有步骤映射改为目标参数 → result/args/context 字段路径；日期提取、员工ID回退、类型转换和多选数组组装保留在 instruction。checker complete 本组仅报差旅 prepare/submit 及对应公开方法的真实调用链缺口，无字段路径或目标引用错误。
- 差旅 prepare 返回 payload.attachmentList，输入仍为 attachments；实际构造载荷全部顶层字段逐个与 SDK 说明核对。保存详情补齐 AttachmentDTO/OssResourceDTO 的 ID、归属、哈希、过期、页数和字节大小字段；请假详情 leavetimeVOs/startUserSelectAssignees 标为后端未填充的 null。
- 新增源码反证：将差旅输出 attachmentList 错改为输入名 attachments → 差旅语义测试变红；finally 恢复源码。
