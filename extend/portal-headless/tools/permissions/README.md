# PH 权限链流水线

这套工具把权限分析拆成三个阶段：

1. `permissions:scan -- --root <Portal Web> --out generated/permission-candidates.ndjson --revision <revision>` 只盘点源码证据。输出页面路径、路由/动作文件、接口引用、关键字命中、导入轨迹和源码版本，不输出 allow/deny 结论。
2. AI 逐条读取候选记录，写入同结构的审阅 NDJSON。`accepted` 必须有页面链、动作链、上下文规则、SDK 方法和源码证据；无法确认的记录写 `blocked` 或 `needs-review`。
3. `permissions:compile -- --candidates ... --reviews ... --capabilities ... --revision ... --out generated/permission-policy.json` 只做结构校验、覆盖率、冲突和 revision 校验。任何 `needs-review`、漏审候选、悬空 capability 或缺少证据都会失败。

生成的策略由 PH 运行时 PermissionGate 消费。服务端只接受 `status=complete` 的策略；默认的 `generated/permission-policy.json` 是 `incomplete`，因此未完成审阅前所有远程能力默认拒绝。
