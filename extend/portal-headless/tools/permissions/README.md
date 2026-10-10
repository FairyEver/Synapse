# PH 权限链流水线

程序盘点事实，AI 逐条理解权限链，PH 服务端执行已审阅策略。不要从权限关键字自动生成放行结论。

## 盘点与审阅

在本包目录执行：

```bash
pnpm permissions:scan --root <Portal-Web源码> --out generated/permission-candidates.ndjson
```

扫描器以 SDK 的全部可执行绑定为权威，按其真实 `pagePath` 解析 Portal 文件路由。证据包包含父级路由、同目录动作、全局路由守卫、权限工具、相对和项目别名导入链、HTTP 方法与接口引用。依赖遍历不截断；找不到路由、别名、动态请求或声明式 URL 的方法时记录 `unresolved`。`--aliases <JSON文件>` 可补充项目别名映射。程序不能据此决定权限；AI 必须结合调用上下文解释路由、动作、all/any、租户/系统/店铺/状态/配置条件及其他入口。

同时输出 `permission-observations.ndjson`，盘点全部源码关键字和请求观察，`linked=false` 表示尚未关联到候选页面，需继续查证；不得把缺少关联当成无权限。`permission-source.json` 记录按文件名与内容计算的源码 hash，不能用任意 Git 标签代替；可选 `--revision` 必须与内容 hash 一致。

AI 使用 `PermissionReview` 类型写审阅 NDJSON。`accepted` 需要页面与动作表达式、上下文规则、对应 `endpointRefs`、Portal `evidence` 和 PH `sdkEvidence`（文件、行号、整行源码）。`sdkPath` 必须来自实际绑定；证据必须同时说明绑定、请求实现和前端操作的对应关系。编译器校验证据存在与一致性，不代替 AI 理解语义。空 `all` 表示无拦截，只允许根表达式，并必须提供 `unrestricted.page/action` 的明确理由及源码证据。未解析引用必须补齐候选证据或标记 `blocked`；`needs-review` 仅供暂存，不能编译。

## 编译与交付

```bash
pnpm permissions:compile --root <Portal-Web源码> --candidates generated/permission-candidates.ndjson --reviews <审阅NDJSON> --revision <源码内容hash> --out generated/permission-policy.json
pnpm build
```

CLI 和 SDK 共用一个编译器，不接受调用方 `--capabilities` 清单。检查全部执行绑定与候选覆盖、状态、重复、同接口冲突、SDK 映射、证据文件/行号、调用点和源码版本；更改源码必须重新盘点和审阅。`complete` 表示所有绑定均为 `accepted` 或 `blocked`，不是全部放行。`blocked` 单独拒绝，不连带阻断已接受的能力。

默认只允许已有可信上下文来源的 `tenant/system` 策略。店铺选择、业务实体状态、配置必须先增加并审阅服务端 `permissionContext` resolver，再通过可信编译配置 `--context-evaluators tenant,system,shop,...` 声明已接入的固定 evaluator。未接入时标记 `blocked`。JSON 不能携带代码或自定义 evaluator，调用参数不能提供授权上下文。

交付 v2 策略和独立的 `permission-source.json`。SDK build 将 Portal revision 与 SDK 源码 revision 固定到 `dist/permissions/source-pin.json`；只替换策略不能改变版本基准。运行时再次校验 schema、全部绑定覆盖、registry hash、独立 revision 和完整内容 hash。SDK 源码变化需要重新编译权限策略。

## 服务端行为

Synapse 适配层必须加载策略和独立 pin；加载失败也启用拒绝闸门。`/invoke`、兼容 `/read` 都走同一个 gate。每次调用重新读取 Portal 权限码，系统条件重新读取企业开通系统，租户来自已验证会话。其他上下文仅来自可信 resolver；缺失、失败或不满足均拒绝。拒绝返回 `PH_PERMISSION_DENIED` 403，不发送目标业务请求，不重试；审计仅记录 capability、policyRevision、failedRule。

直接嵌入的本地 SDK 门面保持既有兼容行为；不得把未装配 gate 的本地门面作为远程执行入口。当前仓库策略仍为 `incomplete`，没有伪造真实审阅或默认放行。合成回归测试不代表普通/管理员双账号真实验收；启用能力前仍需完成逐条审阅及真实 Portal 请求验收。
