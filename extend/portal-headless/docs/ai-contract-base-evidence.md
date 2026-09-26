# 基础 AI 契约补齐证据（2026-09-22）

## 范围基线与完成清单

实际注册与绑定：30 个基础能力（部门/字典/权限 9、外壳 7、企业 2、销售 7、OSS 5），覆盖 0 个真实菜单页面，基础合成上下文不冒充页面覆盖。另有 6 个公开方法：4 个 invalidate、baseUpload.prepare、baseUpload.describeConfig；全部由 catalog.describeMethod 返回契约。

权威语义在 src/catalog/contracts-base.ts；测试经过 createCatalog({capabilities:ALL_CAPABILITY_DEFINITIONS}).describe，而不是仅查看定义对象。docs/pages/base-*.md 从同一契约同步，不重复手写返回语义。

| 批次 | 原缺口 | 已补内容 | 验证 |
| --- | --- | --- | --- |
| 部门/字典/权限 9 | 返回结构被通用推导代替、ID与枚举值消费不清 | 部门根0/路径/候选、dictType→entries.value与id区别、权限清单不等于后端授权 | SDK描述+脱敏形状行为夹具 |
| 外壳 7 | 任务/实例ID易混、流程result无释义、角标部分失败/菜单截断缺约束 | 任务到实例映射、result 3不通过4通过、null非0、完整菜单限制、卡片非页面 | SDK描述+状态语义/业务夹具 |
| 企业 2 | tenants被误当list分页、系统/到期/截断语义不足 | 白名单全字段、最多5页/1000企业、开启关闭枚举与用户状态区别、只读不切换租户 | SDK描述+既有tenant回归 |
| 销售 7 | 多种结果数组混同、shopArea和地区名字键易错 | areas/children/manufacturers/brands分别描述、shopArea→ids、value名称、parentFound、提示布尔非数量 | SDK描述+实际归一化夹具链 |
| OSS 5 | 上传/准备混同、void回执误写成ID、已有删除仍称不可清理 | 真写与本地预览区别、字节/ACL/URL/键、部分失败、删除独立验证与不可恢复 | SDK描述+OSS离线回归 |
| 公开辅助 6 | 不在能力注册表，AI无法下钻 | describeMethod逐项返回inputs/output/steps/副作用 | 实际门面枚举与动态描述核对 |

## 证据与口径

- 前端固定 test/portal/main @74c5f2f0e5、后端固定 test/test @dcb3f360194 由主代理核对并ff-only拉取后读取。
- 主要证据：src/capabilities/base-*.ts 的归一化出口、invoke.ts真实绑定、test/base-*.test.ts已有真机形状脱敏夹具；历史观测记录在docs/base/*.md，本轮没有重放真实写入。
- 新校正：BpmProcessInstanceResultEnum 的中文desc明确1待提交/2待签订或待审核/3不通过/4通过/8已取消，英文常量名相反，不能凭英文猜。SysUserDTO明确gender0男1女2保密、status0停用1正常；TenantDO/CommonStatusEnum与HrSystemTenantRespVO明确租户0开启1关闭。
- 数据限制已在实际SDK契约表达：租户system码1–6有中文来源，其它码保留；到期时间无时区口径时不作自动过期判断；OSS删除成功不证明原先存在；未知ACL和网络错误不能证明文件已不存在。

## 实测检查和反证

- pnpm exec vitest run test/ai-contract-base.test.ts test/base-dept-dict-permission.test.ts test/base-shell.test.ts test/base-tenant.test.ts test/base-sale.test.ts test/base-upload.test.ts：6文件通过，291通过，7个需要真实OSS环境的LIVE用例跳过。
- 新增SDK语义测试9条通过；pnpm typecheck通过。
- 反证1：删除输出size语义字段（改成sizeRemoved）→“上传实际写入”测试RED；恢复后GREEN。
- 反证2：将result=4从“通过”改成“不通过”→流程结果测试RED；恢复后GREEN。
- 反证3：将shopArea→ids错改shopId→ids→销售字段链测试RED；恢复后GREEN。
- 未测：本轮没有线上只读重抓、OSS实际上传/删除、权限变化实测。既有历史观测不被冒充本轮实测。全量pnpm docs和提交由主代理统一执行。

## 公开入口盘点与处理

构造SDK无网络读取；当前dist镜像枚举自身函数得到389项（含http/目录工具/实例内部函数，不等于业务能力数）。基础五族在源码构造测试中独立核对：30注册绑定+6下钻方法，未遗漏业务入口。src/index.ts和src/server.ts均公开这五族；多用户接口通过forSession隔离请求。

批量生成：src/capabilities/generated/index.ts存在BATCH_CAPABILITIES/BATCH_IN_SCOPE_CAPABILITIES/createBatchListCapability，但src/index.ts、server.ts、capabilities/index.ts、invoke.ts均未接线；它们是生成审计物，不能宣称默认SDK可调用。范围外factory拒绝，范围内仅允许显式工厂构造，尚不等于默认目录注册。

其余发现的公开自有方法（供主代理与各owner逐项覆盖；已排除本批已处理基础方法）。低层http/call、catalog本身、会话/防重类的原型方法需另按基础设施口径盘点；下表不宣称这些全部都是业务方法。

| SDK路径 | 处理归属 |
| --- | --- |
| http | 相应模块owner/主代理描述与作用域核对 |
| call | 相应模块owner/主代理描述与作用域核对 |
| resolveModuleType | 相应模块owner/主代理描述与作用域核对 |
| idempotency.now | 相应模块owner/主代理描述与作用域核对 |
| idempotency.classifyFailure | 相应模块owner/主代理描述与作用域核对 |
| catalog.listMethods | 相应模块owner/主代理描述与作用域核对 |
| catalog.describeMethod | 相应模块owner/主代理描述与作用域核对 |
| catalog.listDomains | 相应模块owner/主代理描述与作用域核对 |
| catalog.listPages | 相应模块owner/主代理描述与作用域核对 |
| catalog.describePage | 相应模块owner/主代理描述与作用域核对 |
| catalog.search | 相应模块owner/主代理描述与作用域核对 |
| catalog.recommend | 相应模块owner/主代理描述与作用域核对 |
| catalog.describe | 相应模块owner/主代理描述与作用域核对 |
| catalog.validate | 相应模块owner/主代理描述与作用域核对 |
| catalog.withVisibility | 相应模块owner/主代理描述与作用域核对 |
| visibleCatalog | 相应模块owner/主代理描述与作用域核对 |
| meetingRoom.get | 相应模块owner/主代理描述与作用域核对 |
| meetingApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| assignment.create | 相应模块owner/主代理描述与作用域核对 |
| attendanceShift.create | 相应模块owner/主代理描述与作用域核对 |
| attendanceTeam.create | 相应模块owner/主代理描述与作用域核对 |
| baseImage.create | 相应模块owner/主代理描述与作用域核对 |
| baseImage.createRelease | 相应模块owner/主代理描述与作用域核对 |
| baseManagementCenter.create | 相应模块owner/主代理描述与作用域核对 |
| contractTemplate.create | 相应模块owner/主代理描述与作用域核对 |
| generalApproval.submit | 相应模块owner/主代理描述与作用域核对 |
| generalApproval.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| leaveApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| leaveApplication.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| vehicleApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| vehicleApplication.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| vehicleApplication.resolveProcessInstanceId | 相应模块owner/主代理描述与作用域核对 |
| travelExpense.profile | 相应模块owner/主代理描述与作用域核对 |
| travelExpense.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| travelExpense.previewApprovalChain | 相应模块owner/主代理描述与作用域核对 |
| travelExpense.amount | 相应模块owner/主代理描述与作用域核对 |
| travelExpense.submit | 相应模块owner/主代理描述与作用域核对 |
| productDesignApproval.submit | 相应模块owner/主代理描述与作用域核对 |
| productDesignApproval.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| taskAction.myRunningTasks | 相应模块owner/主代理描述与作用域核对 |
| taskAction.currentUserId | 相应模块owner/主代理描述与作用域核对 |
| taskAction.searchUsers | 相应模块owner/主代理描述与作用域核对 |
| taskAction.approve | 相应模块owner/主代理描述与作用域核对 |
| taskAction.reject | 相应模块owner/主代理描述与作用域核对 |
| taskAction.transfer | 相应模块owner/主代理描述与作用域核对 |
| taskAction.delegate | 相应模块owner/主代理描述与作用域核对 |
| taskAction.returnTask | 相应模块owner/主代理描述与作用域核对 |
| taskAction.batchApprove | 相应模块owner/主代理描述与作用域核对 |
| taskAction.batchReject | 相应模块owner/主代理描述与作用域核对 |
| taskAction.returnIdempotent | 相应模块owner/主代理描述与作用域核对 |
| overtimeApplication.resolveDerivedFields | 相应模块owner/主代理描述与作用域核对 |
| overtimeApplication.findSelfInApprovalChain | 相应模块owner/主代理描述与作用域核对 |
| overtimeApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| overtimeApplication.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| restLeaveApplication.resolveDerivedFields | 相应模块owner/主代理描述与作用域核对 |
| restLeaveApplication.findSelfInApprovalChain | 相应模块owner/主代理描述与作用域核对 |
| restLeaveApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| restLeaveApplication.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| businessTripApplication.resolveDerivedFields | 相应模块owner/主代理描述与作用域核对 |
| businessTripApplication.findSelfInApprovalChain | 相应模块owner/主代理描述与作用域核对 |
| businessTripApplication.submit | 相应模块owner/主代理描述与作用域核对 |
| businessTripApplication.findInstanceByBusinessKey | 相应模块owner/主代理描述与作用域核对 |
| perfManageConfig.listFormulaScenes | 相应模块owner/主代理描述与作用域核对 |
| perfManageConfig.getDictTypeId | 相应模块owner/主代理描述与作用域核对 |
| perfManageConfig.getProtocolDeductRule | 相应模块owner/主代理描述与作用域核对 |
| perfManageConfig.listProtocolDeductRuleHistory | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.prepareCreate | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.prepareMove | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.createFile | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.cancelRename | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.cancelMove | 相应模块owner/主代理描述与作用域核对 |
| aiKnowledge.cancelSetPermission | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareCreateHotQuestion | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.cancelCreatedHotQuestion | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareUpdateHotQuestion | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareSetChatDisplay | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareConvertChatToHot | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.cancelConvertedHotQuestion | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareCreateWhitelistWord | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.cancelCreatedWhitelistWord | 相应模块owner/主代理描述与作用域核对 |
| aiInteractionQa.prepareUpdateWhitelistWord | 相应模块owner/主代理描述与作用域核对 |
| aiModel.prepareSaveModel | 相应模块owner/主代理描述与作用域核对 |
| aiModel.cancelCreatedModel | 相应模块owner/主代理描述与作用域核对 |
| aiModel.restoreModel | 相应模块owner/主代理描述与作用域核对 |
| aiModel.testModelConnectivityFromForm | 相应模块owner/主代理描述与作用域核对 |
| aiModel.prepareSaveQuotaRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.getQuotaRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.cancelCreatedQuotaRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.restoreQuotaRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.prepareSaveFlowRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.getFlowRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.cancelCreatedFlowRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.restoreFlowRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.prepareHandleApply | 相应模块owner/主代理描述与作用域核对 |
| aiModel.cancelHandledApply | 相应模块owner/主代理描述与作用域核对 |
| aiModel.fillApplyWithQuotaRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.fillApplyWithFlowRule | 相应模块owner/主代理描述与作用域核对 |
| aiModel.prepareSaveModelSelection | 相应模块owner/主代理描述与作用域核对 |
| aiModel.cancelCreatedModelSelection | 相应模块owner/主代理描述与作用域核对 |
| aiModel.restoreModelSelection | 相应模块owner/主代理描述与作用域核对 |
