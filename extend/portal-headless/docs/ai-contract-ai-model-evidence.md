# AI模型四页说明补齐证据（2026-09-22）

## 范围和所有权

按当前 `ALL_CAPABILITY_DEFINITIONS` 与 `CAPABILITY_BINDINGS` 重新盘点：模型列表17、模型选择4、平台用量6、数据分析1，共4个菜单页面、28个已注册可执行能力；实际 `sdk.aiModel` 对象另有19个未注册辅助方法。新增契约导出 `AI_MODEL_CONTRACTS` 与 `AI_MODEL_METHOD_CONTRACTS`，主代理接入 `catalog.describe` / `describePage` / `describeMethod`。工作区对这些页面的执行实现属于另一并行会话，契约不静态导入该实现，而依据实际注册条件发布；尚未登记AI模块的提交树中两表为空，专属测试跳过，不把未提交实现混入本轮。

本组可写且已修改：`src/catalog/contracts-ai-model.ts`、`test/ai-contract-ai-model.test.ts`、本文、四份对应页面文档；额外按主代理要求修改 `contracts-base.ts` 两条ACL来源为 `args.objectKey`。没有写git、启动浏览器/服务、新增依赖、调用真实写接口。页面文档原本是另一会话未跟踪文件：只追加契约区，并纠正已有明确过时的密钥/分支/函数模块返回叙述，提交归属由主代理决定。

## 权威证据和分层

- 当前SDK实现：`src/capabilities/ai-model.ts` 的请求装配、请求层拆data、prepare/save/restore/fill；`invoke.ts` 实际绑定。
- 前端固定 `test/portal/main@74c5f2f0e5`（主代理核对并fast-forward）：`interaction/model`、`interaction/modelSelect`、`common/model-usage`、数据分析页面。
- 后端固定 `test/test@dcb3f360194`（主代理核对并fast-forward）：`AiModelConfigDTO`、`AiModelSelectionDTO/DetailDTO`、`AiToken*RespVO/DO` 与Controller/Service、状态枚举、统计控制器。父类字段与子类覆盖按最终派生声明去重，不能把Java类型名当调用方可见结构。
- 历史 `baseline/ai-model.browser.json` 共23条GET，只证明页面请求和无module-type，不证明响应字段或写入闭环。无新真实读写冒烟。
- 返回字段来自当前后端与SDK透传组合推导：28能力共497条嵌套字段声明、146条输入声明（含条件参数与结构化字段）；并非497条全部有线上响应基准。契约对后端可缺/可null字段不承诺必然存在。
- `test/ai-contract-ai-model.test.ts` 检查SDK实际描述输出，不只检查定义对象；实际SDK门面使用脱敏adapter夹具确认prepare不POST、模型保存null、规则新增ID/修改true及status4可实际发送。该夹具是离线行为验证，不是部署成功证据。

## 纠正的关键业务含义

1. `AiModelConfigServiceImpl` 当前列表注释了 `item.setApiKey(null)`，详情也未清空apiKey/authToken；可用候选才明确清空。SDK透传，不能继续宣称详情只有掩码。`restoreModel` 只使用显式 `options.apiKey`，不自动使用previous.apiKey；也不恢复测试元数据。
2. 连通性 `availableStatus` 为0未测试/1正常/2异常；测试POST不保存模型配置，但会调用上游，不能宣称没有外部调用成本。
3. 已发布技能来自 `ai-prompt-skill-list({name:关键字,isPublish:1}).list[].id`，不是可用模型ID；个人规则候选映射为 `phone→targetUserPhone`、`userName→targetUserName`、`tradeStr→targetUserTypeName`。
4. 模型/模型选择保存返回null；规则新增返回ID、修改/删除返回boolean。准备仅构建载荷并按需读取旧行，不能冒充提交。新增模型撤销按名称第一页精确唯一匹配，存在分页/重名边界；恢复是重新写入，不是事务回滚。
5. 模型选择details逐项使用code/modelId/isDefault，旧详情skillIdList需转skillIds。调用类型2后端要求非空技能。prepare.payload/current嵌套结构均通过SDK说明下钻。
6. 平台额度默认月3，用量明细默认周2及本月时间范围2；durationMs毫秒、durationMsStr为秒展示；usageRate已经是百分比，交互rightRate是0–1。功能模块为名称字符串数组；工具排行是x/y对象，不是行列表。
7. 聚合4路/6路各自settle，null结合errors判失败/跳过，不能读作零；x/y按同下标配对。日期闭区间补00:00:00到23:59:59，不是次日开区间。
8. SDK申请处理只验证非空数字，4可实际发出；当前后端状态0待处理/3已驳回/4已处理，旧前端1忽略/2填写冲突保留为明确缺口。单独handle不增加额度。一键填写两次真写且非事务，第二步失败可能已有规则但整体抛错；必须回查清理，不能重复执行。skipApplyStatus仍会创建规则。

## 已验证和反证

- `pnpm exec vitest run test/ai-contract-ai-model.test.ts test/ai-model.test.ts test/ai-contract-base.test.ts`：114通过、10原有TODO；新增模型契约9例、基础契约9例。TODO是原有真实写验证待办，未删除/放松。
- `pnpm typecheck`、`pnpm build`通过。
- `node tools/ai-contract/check.mjs`：全工作区305/305已注册能力、96方法，结构问题0；这是引用/字段路径校验，不是线上业务完成证明。
- 真实修改本组契约后运行专属语义测试，每次恢复：申请status4“已处理”改成“已忽略”→红；个人候选来源phone改成id→红；prepare行为改write→红。恢复后三项对应断言均绿。日志在 `/tmp/ai-model-mutation-*.txt`（临时验证日志，不作为SDK说明来源）。
- 主代理统一运行全仓测试、docs生成与提交；子代理没有写其他人的生成文件。

## 尚缺证据（不能计为全量验收通过）

具体契约缺口2类，影响2个注册能力、4个辅助方法：

- `ai-model-apply-record-list`、`ai-model-apply-handle`、`aiModel.prepareHandleApply`、`aiModel.cancelHandledApply`、两种 `fillApplyWith*Rule`：前端状态1/2与固定后端0/3/4不一致。需要部署状态查询与授权的定向处理/恢复闭环；描述如实返回冲突和恢复限制，不能靠离线adapter证明线上接受。
- `aiModel.fillApplyWithQuotaRule` / `fillApplyWithFlowRule`：个人payload发targetUserId，后端SaveReqVO只消费targetUserPhone，现有执行链无法证明规则落到申请人。当前可用替代是已注册规则save配合phone候选；修复旧执行行为不属于本轮仅补描述的子任务。

未重放真实写不自动把其余所有写契约判成缺失；已有实现、固定源码和离线验证支持其调用说明。但四页历史写闭环本来就未做，且现有浏览器没有返回body基准，不能写成真实操作已验收。这些验证局限与上面具体结构/行为冲突分别记录。

## 可持续逐项清单

下表由当前注册与契约导出生成；共同证据与验证范围见上节，新增注册会被测试的注册集合和真实门面未注册方法清单校验发现。

| 入口 | 参数/返回字段数 | 状态 |
| --- | --- | --- |
| `ai-model-list` | 3/26 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-detail` | 1/24 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-available-list` | 1/24 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-save` | 12/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-delete` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-test` | 4/3 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-quota-rule-list` | 4/38 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-quota-rule-save` | 17/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-quota-rule-delete` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-flow-rule-list` | 7/30 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-flow-rule-save` | 16/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-flow-rule-delete` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-rule-history` | 6/27 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-apply-record-list` | 7/27 | 说明已交付；有上述具体证据缺口 |
| `ai-model-apply-pending-count` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-apply-handle` | 3/1 | 说明已交付；有上述具体证据缺口 |
| `ai-model-search-user` | 3/4 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-selection-list` | 3/27 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-selection-detail` | 1/26 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-selection-save` | 7/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `ai-model-selection-delete` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-quota-list` | 7/17 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-quota-summary` | 5/4 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-usage-list` | 16/60 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-usage-analytics` | 14/55 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-usage-detail` | 1/58 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `platform-usage-function-module-list` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `data-analysis-overview` | 2/36 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.prepareSaveModel` | 12/38 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.cancelCreatedModel` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.restoreModel` | 3/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.testModelConnectivityFromForm` | 1/3 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.prepareSaveQuotaRule` | 17/56 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.getQuotaRule` | 1/36 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.cancelCreatedQuotaRule` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.restoreQuotaRule` | 2/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.prepareSaveFlowRule` | 16/47 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.getFlowRule` | 1/28 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.cancelCreatedFlowRule` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.restoreFlowRule` | 2/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.prepareHandleApply` | 3/5 | 说明已交付；有上述具体证据缺口 |
| `aiModel.cancelHandledApply` | 2/1 | 说明已交付；有上述具体证据缺口 |
| `aiModel.fillApplyWithQuotaRule` | 7/3 | 说明已交付；有上述具体证据缺口 |
| `aiModel.fillApplyWithFlowRule` | 7/3 | 说明已交付；有上述具体证据缺口 |
| `aiModel.prepareSaveModelSelection` | 7/37 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.cancelCreatedModelSelection` | 1/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
| `aiModel.restoreModelSelection` | 2/1 | 说明、接线、离线校验完成；真实覆盖范围见上 |
