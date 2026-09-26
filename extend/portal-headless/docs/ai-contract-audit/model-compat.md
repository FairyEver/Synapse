# 模型申请协议与一键填写兼容修复

## 范围与证据

仅修改 Headless SDK。Web、Java 参考仓库均只读，未 pull/checkout、未运行真实请求。

- Web `test/portal/main@d3cf56bdc76c73c5eb9252be84b9b39b3900b48e`：`app/portal/views/dashboard/platform/intelligence/interaction/model/utils.js:3–14` 仍定义 `0待处理/1忽略/2填写/3驳回`；`getRuleTarget` 与 `useApplyModals.js` 仍使用 `targetUserId` 和填写状态 `2`。
- Java `test/test@dcb3f360194e63c33cfd7ef9df4360355ff13533`：`AiTokenQuotaApplyStatusEnum` 只定义 `0待处理/3已驳回/4已处理`；`AiTokenQuotaApplyHandleReqVO.status` 有 `@InEnum` 校验。没有证据能把旧 `1` 或 `2` 自动解释为某个新值。
- `AiTokenQuotaApplyDO` 真实返回 `userPhone`；`AiTokenQuotaRuleSaveReqVO` / `AiTokenFlowRuleSaveReqVO` 接收 `targetUserPhone`，不接收 `targetUserId`。`AiTokenManagementServiceImpl.matchFlowRuleTarget` 以手机号和租户匹配个人规则；额度规则创建时省略 `targetTenantId` 会由后端归一为 `0`；流速规则不做此归一，`validateRuleTarget` 要求个人scope=3的目标租户非null且手机号非空。故流速必须由SDK显式发送0。
- `AiTokenManagementServiceImpl.handleQuotaApply` 只修改申请状态、驳回原因、处理人和时间，不创建规则。非驳回状态清除驳回原因；恢复状态不是恢复整条历史。
- 当前 `ai-model.ts` 属于另一工作单元。兼容模块没有静态导入它，独立已提交 HEAD 缺少该能力时仍可构建和执行独立测试。

## SDK 执行与调用契约

`withAiModelCompatibility(client)` 只要求既有 `listApplyRecords`、`handleApply`、`saveQuotaRule`、`saveFlowRule` 方法，保留其他属性。`installAiModelCompatibility(host)` 在存在有效 `host.aiModel` 时原地安装，用 `WeakSet` 防止重复包装；没有模型模块时不处理。安装前绑定原始函数，避免原地替换后自递归。

主代理在 `createCapabilityInvoker(host)` 入口安装，因此现有 Portal/Server 门面直调与能力 `invoke` 使用同一模型对象。既有方法名称与参数顺序保留：

- `listApplyRecords({status?})`、`prepareHandleApply(apply,status,options?)`、`handleApply(apply,status,options?)`、`cancelHandledApply(id,previousStatus)` 仅允许数字 `0/3/4`；旧 `1/2` 在请求前拒绝，不做猜测转换。列表不填状态仍查询全部状态。
- 两个 `fillApplyWith*Rule({apply,form?,skipApplyStatus?})` 继续创建规则，然后明确将本次已配置申请写为 `4已处理`。这是完成当前配置动作的业务状态，不是旧状态 `2` 的通用迁移。
- 非零正整数 `apply.tenantId` 仍按既有页面分支创建租户规则；缺失/null/0/字符串 `"0"` 为个人分支。个人分支优先取 `apply.userPhone`；缺失时要求用户从真实 `ai-model-search-user` 候选确认 `phone/userName/tradeStr`，填入 `form.targetUserPhone/targetUserName/targetUserTypeName`。不自动按姓名选人，不把用户 ID 转成手机号；两个手机号冲突时写前拒绝。
- `form` 保持既有费用/流速配置字段。额度使用 `form.totalQuota ?? apply.expectedMonthlyQuota`；单次 Token 使用 `form.maxTokenPerRequest ?? apply.expectedMaxToken`。必需的周期、策略、起始时间等在写前校验。Token必须正整数，额度和每分钟Token上限不超过9007199254740991，单次Token不超过2147483647；字符串仅接受十进制整数形式并转为安全数值，不能借任意长字符串规避精度限制。`form.id` 不进入载荷，始终新建规则。
- `skipApplyStatus=true` 只跳过第二次写入，并非 dry-run；结果仍含真实 `createdRuleId`，`applyHandled=null`。

`catalog.describe()` 与 `describeMethod()` 实际返回上述参数、候选映射、0/3/4 枚举、返回回执、恢复步骤及未部署实测边界。已修复的状态校验/手机号结构缺陷不再留作未解决 `gaps`；当前Portal可见“忽略”固定发1与Java冲突，已重新列为页面功能缺口，不再要求用户决定是否需要该动作。

## 部分写入与恢复

两次写入没有事务或 requestId 去重。第二次异常或返回 `false` 时，抛本地 `AiModelApplyPartialWriteError`：

| 属性 | 含义 |
| --- | --- |
| `code` | 本地标记 `AI_MODEL_APPLY_PARTIAL_WRITE`，不是后端错误码 |
| `createdRuleId` | 首次创建已收到的真实规则 ID |
| `applyId` | 申请 ID |
| `ruleKind` | `quota` 或 `flow`，用于选择规则回读/删除入口 |
| `stage` | `handleApply`，失败发生在第二步 |
| `previousStatus` | 调用方原申请状态，可能缺失或陈旧 |
| `applyHandled` | `null`，申请写入结果需要回读 |
| `cause` | 原始异常；保留诊断原因 |

调用方先按 `createdRuleId` 读规则，再查询同一申请。规则正确但申请尚未处理时，仅调用 `handleApply({id:applyId},4)`，禁止直接重跑整个 fill。用户要求撤销时，按明确规则 ID 删除本次创建，再在有证据时恢复原申请状态；不自动删除、不自动重发。第一步超时或没返回有效 ID 无法凭空恢复 ID，只能按模型及目标手机号/租户回查，不能宣称未写入。

## 验证与盲区

- 独立兼容测试 9 项通过，包括无模型模块安装、重复安装、旧值拒绝、个人手机号、候选补充、手机号冲突、租户/零租户、跳过第二步、部分写入保留 ID、首步不确定结果，以及包裹当前真实 SDK 执行函数后核对发出的规则与状态载荷。新增带旧fill签名的类型调用测试，不使用any/cast而直接填写新手机号字段；`CompatibleAiModel<T>`明确移除旧签名并发布兼容方法。
- 实际源码反证逐次修改 `ai-model-compat.ts` 并 finally 恢复：填写状态 `4→2`，5 失败/3 通过；手机号改用 userId，4 失败/4 通过；错误对象移除 `createdRuleId` 属性，1 失败/7 通过。恢复后 8/8 通过。
- `test/ai-contract-ai-model.test.ts` 检查实际 SDK 描述与门面/能力调用；最终执行结果随主代理公共接线完成后补记。首次执行因其他代理尚未落地 `contract-template-schema.ts` 阻塞，未修改对方文件；当时 typecheck 唯一报错也是该文件缺失。
- 未部署实测：没有对真实用户申请创建规则、处理、删除或恢复状态。固定源码与离线执行证明请求和本地失败处理，不能代替服务端部署版本、权限、实际规则命中及业务副作用回读。
- 页面协议冲突：Portal待处理行实际存在“忽略”按钮并发送 `1`，Java不接受该值。该功能属于SDK对齐范围，保留未完成标记；不再要求用户决定是否需要页面已存在的操作。

### 接线完成后的验证

- SDK描述与实际门面已接线后，`pnpm exec vitest run test/ai-model-compat.test.ts test/ai-contract-ai-model.test.ts`：2文件19测试通过；`pnpm typecheck`通过。
- 扩展运行原有模型执行及invoke回归：此前4文件135通过、10既有todo；随后仅增加1项类型兼容测试，通过且无执行修改。既有todo未当成已验证。
- 实际Portal门面直调和capabilities.invoke旧1/2均在HTTP adapter前拒绝；真实fill序列发送phone规则、status4，第二次HTTP失败时向调用方保留createdRuleId=715的测试回执。
- 新增/改动文件仅分工内五项；未运行任何写Git命令，公共安装接线与导出由主代理负责。

### 流速目标租户再复核

- 后端 `createFlowRule:188–192` 与额度创建不同，不补缺省租户；先前“后端统一归一0”的说明已更正。
- 导出 `normalizeAiModelRequest<T>(config):T`，主代理在唯一公共 `createPageCall` 发送前接线。只有精确 `POST /admin-api/ai-token/flow-rule/create` 或 `PUT /admin-api/ai-token/flow-rule/update`、ruleScope为3/字符串3、targetUserPhone为非空字符串且targetTenantId为null/undefined时，复制请求并补0。不同URL/方法、非个人范围、已有目标租户均保持原对象，不改原输入。
- 公共 Portal/Server 门面安装模型兼容并经过请求归一；独立调用原 `createAiModelCapability` 不会自动替换其旧fill实现，不能将原工厂的旧targetUserId/status2行为当成公共门面契约。
- 个人流速公共门面真实执行测试模拟Java校验：缺目标租户或手机号即拒绝；fill创建和save修改都确认body含targetTenantId=0及phone。源码反证删除归一返回，实际门面测试1失败/10跳过，报“个人规则必须选择租户和用户手机号”；finally恢复。
- 当前个人规则草稿构造器丢弃非零targetTenantId，因此此修复面向个人租户0。不能用该入口配置或恢复企业租户内个人规则；契约明确此边界，未猜测新增分支。
- fill的apply.status只保存为恢复快照，可能为旧1/2或缺失；不将其当目标状态校验，也不缺省成0。直接handle/prepare/cancel的目标状态仍只接受0/3/4。对应两类行为分别测试。
- 扩展运行4文件时，外部未跟踪 `test/ai-model.test.ts:1030` 的原工厂流速fill字节快照因新增targetTenantId=0失败（原测试期望旧缺字段行为）；该文件不在分工范围，未修改。它不验证本次公共门面兼容，已报告主代理。

- 再收窄请求归一：没有有效targetUserPhone的旧targetUserId载荷不处理，避免修半套目标；无phone/空白phone边界测试已加入。外部原factory字节回归因此保持原行为。

- 最终收窄后扩展回归：4文件140通过、10既有todo；typecheck通过。原工厂旧字节测试恢复通过；公共SDK个人流速Java语义测试仍通过。

## Portal可见性口径复核（2026-09-22）

- `ApplyRecordModal.vue:47–50` 只在原始数字 `status===0` 时显示“一键填写”和“忽略”；`composables/useApplyModals.js:44–46` 忽略固定发送 `APPLY_STATUS.ignored=1`。不是已被页面删除的旧功能。
- `ApplyRecordModal.vue:79` 的筛选来自 `getAiTokenDictOptions(ai_token_quota_apply_status)`，不是直接使用旧 `APPLY_STATUS_OPTIONS`。状态列 `:43` 优先 `statusName`，再经平台字典、旧常量回退；均无值显示“-”。SDK描述已给 `base-dict-get({dictType:'ai_token_quota_apply_status'})` 的实际下钻和 `entries[].value → status`、`entries[].label → 展示` 映射；不能假定在线字典必然含1/2。
- `AiTokenQuotaApplyPageReqVO.status` 与 `AiTokenQuotaApplyHandleReqVO.status` 均有 `@InEnum`，Controller 的 page 与 handle 均有 `@Valid`，所以SDK对查询1/2的拒绝与当前Java一致，不是额外新增业务限制。
- handle和prepareHandleApply把页面可见“忽略”与Java冲突明确列为gap；辅助cancel仍只支持恢复0/3/4，不因恢复旧1/2额外扩大页面完成条件。不把SDK底层重置/驳回参数误说成Portal有对应按钮。
- 本轮未改Web/Java、未执行线上操作；证据仍是上述固定源码及离线SDK测试。
- 本轮验证：`pnpm exec vitest run test/ai-contract-ai-model.test.ts test/ai-model-compat.test.ts` 25项通过；`pnpm typecheck`通过。两个实际源码反证（删除忽略协议gap、将字典value映射错写为条目id）各返回exit 1；恢复后25项通过。说明断言通过SDK实际catalog.describe/describeMethod读取，未用线上写入作验证。
