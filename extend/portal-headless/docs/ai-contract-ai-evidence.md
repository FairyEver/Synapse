# 知识、交互与提示工程 AI 契约证据

范围由当前注册定义过滤，源文件为 `contracts-ai-core.ts`、`contracts-ai-prompt.ts`；统一接入 catalog.describe、describePage、describeMethod。没有静态导入其他会话尚未提交的 AI 实现；相应能力未注册的独立检出中不会发布这些契约。

参考版本：Portal test/portal/main@74c5f2f0e5；后端 test/test@dcb3f360194。核对 SDK 实际执行方法、现有浏览器基准和控制器/VO/SQL。此批没有新发真实写请求；历史基准不等于这次重新验证。

## 已核对的业务差异

- 知识目录 `{isAdmin,list}` 没有 total；审核记录 id 不等于 fileId/knowledgeId；改名目标先在 newContent，不能把旧文件名解释成提交失败。
- 权限回显有全部用户/空指定用户歧义，指定角色候选未暴露。这是具体缺口，set-permission 与 cancelSetPermission 保留 gaps；不报告权限已被跨账号验证。
- 问答 useful=null 是无操作（筛选用 status=-1）；删除热门会重置关联问答 isHot。热门 type=1人工/2系统；mix.total 沿用系统查询总数，不能当混合总量。
- 技能提交为整树覆盖，节点仅 Number(enabled)===0 禁用；审核可能消耗 AI 资源但不保存，审核结果不能作提交草案。
- 业务事件、开放接口、模板绑定的 create/update/remove 等注册入口只返回 WritePlan。真正 submit/cancel 为额外公开方法，通过 describeMethod 提供完整说明。assertPlan 不校验跨组来源，不能宣称它有这层保护。
- 事件记录查询用 eventCode；重试用执行记录 id，仅状态3/4/5可重试。durationMs为毫秒；重试技能可能产生不可撤销业务副作用。
- 开放接口 scan 结果没有登记 id；无匹配抛业务错误，不归一为空数组。当前列表/详情缺少页面所引用的 isBound 字段，不能因缺失而断言未绑定。
- 模板绑定创建返回null，更新/删除返回true；业务事件创建返回数值id，其他写回执按当前控制器处理。字典候选用 entries[].value/label。

## 验证

`test/ai-contract-ai.test.ts` 通过 SDK 真实描述入口，结合可调用能力的离线响应与准备结果校验状态、映射、回执、完整配置及副作用；不会发出网络请求。SDK缺少这些在途AI注册时该组明确跳过，不将跳过算验证通过。

三项源码反证分别执行，均出现1 failed，其余8 passed，随后恢复：

1. 删除审核返回 newContent 的关键字段描述。
2. 把审核状态1/2含义互换。
3. 把业务事件到执行记录的 eventCode 映射改成对象 id。

独立复核另纠正 enabled归一、弱计划校验、isBound缺失、scan空结果异常、新建prepare的payload.id=null、mix总数，新增相应语义断言。最终测试总数和完整检查记录见 `docs/ai-contract-audit/README.md`；逐能力证据/缺口由 `current.json` 可持续重建。
