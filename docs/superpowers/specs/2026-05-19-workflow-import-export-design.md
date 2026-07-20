# Workflow Share Package V4 Design

## Status

本文件是工作流导入、导出与同事分享的当前权威规格，取代最初的单工作流 JSON / V1 设计。旧 V1、V2、V3 文件继续兼容导入，但新导出统一使用 V4。

相关决策记录：

- [保留正文中的敏感字面值](../../adr/0023-preserve-persisted-sensitive-workflow-literals-in-share-packages.md)
- [同一分享谱系的新修订原地覆盖](../../adr/0024-treat-new-share-lineage-revisions-as-authoritative.md)
- [分享包不携带 Automation 实例](../../adr/0025-exclude-automation-instances-from-workflow-share-packages.md)
- [区分包完整性与来源真实性](../../adr/0026-distinguish-share-package-integrity-from-authenticity.md)
- [分享包不分发节点实现代码](../../adr/0027-do-not-distribute-executable-node-code-in-workflow-share-packages.md)

## Outcome

工作流分享的目标是让同事在模型供应商、模型名称、项目路径和本地资源不同的环境中，用尽可能少的操作完整复现发送方的工作流程。

它不是整机备份，不复制发送方本地身份，不携带运行历史、参数预设、Automation 实例、节点实现代码或本地文件字节。

## Current implementation and gaps

当前实现已经具备文件权限审计、导入文件大小限制、安全读取、摘要复查、V1/V2/V3 JSON 识别、模型映射和导入后校验，但仍存在以下结构性缺口：

| 现状 | 缺口 |
|---|---|
| `.synapse-workflow.json` 单 JSON | 无法稳定扩展多工作流、文件清单、摘要和未来附件 |
| 包内只有一个 `workflow` | 调用子工作流时无法完整复现 |
| 只扫描 Prompt / Switch 模型 | 新节点和 App Capability 节点容易漏报依赖 |
| 模型引用按供应商、档位、模型名分组 | 同一实际模型会因档位拆成多组 |
| 只有一个目标项目 | 多来源项目关系丢失，节点显式项目会被删除 |
| 引用 ID 使用 `model-ref-1` 顺序编号 | 新修订中不稳定，无法可靠复用历史映射 |
| 导入总是生成一个新工作流 | 无谱系、幂等导入和后续更新能力 |
| `formatVersion` 只接受精确 `3.0.0` | 无法接受兼容的 minor / patch 扩展 |
| 无分享预检 | 敏感字面值、本地文件、运行时和高风险节点不可见 |
| 循环调用 `save` | 无法原子处理整组新增、覆盖、删除和外部状态调整 |
| 保存无预期修订校验 | 活动编辑器可能覆盖刚导入的版本 |

现有运行历史不依赖当前定义：每次运行快照保存当次工作流定义和节点结果，因此工作流从五个节点更新为三个节点后，旧记录仍按五个节点展示。谱系原地更新必须保留这些快照。

## Product invariants

- 分享单位是一个或多个入口工作流及其递归子工作流依赖集；当前 UI 只选择一个入口，格式从 V4 起使用入口数组。
- 工作流外层继续满足 DAG 约束；跨工作流调用不得形成循环，运行时调用深度不得超过当前五层限制。
- 根工作流和全部子工作流必须来自同一组已保存、已迁移、已校验的修订。
- 导出和导入都由主进程分享服务负责；Renderer 只展示类型化预检并提交用户选择。
- 每种节点都必须通过节点 manifest 声明分享契约，中央服务不得维护节点类型硬编码清单。
- 发送方来源到接收方本地目标是唯一映射方向。
- 导入不会自动运行工作流、安装代码、取消运行或丢弃编辑草稿。

## Export flow

导出入口同时存在于工作流列表和编辑器。

### Save gate

- 编辑器中的根工作流有未保存修改时，操作为“保存并导出”。保存或校验失败则停止。
- 任一递归子工作流存在未保存修改或正在保存时，阻止导出并列出名称，不自动替用户保存。
- 预检完成后再次比较全部修订标识；确认期间有任一修订变化时刷新预检，不能生成混合修订包。
- 缺失子工作流、跨工作流调用循环或超过五层调用深度时阻止导出。
- 同一子工作流被多处引用时只打包一次。

### Export panel

面板只提供一个可编辑字段：分享说明。其余内容均由系统计算并只读展示：

- 入口工作流、子工作流和修订。
- 模型引用、项目引用和外部资源。
- 必需能力和运行时要求。
- 敏感字段位置、高风险节点和脚本可移植性提示。
- 未包含的关联 Automation 数量。

分享说明在本地确定性生成，来源仅包括工作流描述、参数定义、外部文件和环境前置条件；不得调用模型，不得复制敏感字面值。用户可以编辑或恢复自动生成内容。

### Sensitive literals

工作流文档内直接保存的 Token、密码、请求头、脚本 ENV、URL 查询值或其它敏感字面值被视为作者有意分享，原样导出。

导出预检只显示工作流、节点和字段位置，不显示值，不提供“排除此字段”复选框。作者可以取消导出、修改工作流后重试。运行参数实际值、参数预设和运行历史不导出。

## Import flow

导入使用固定顺序向导。空步骤自动跳过；返回上一步保留选择；错误显示在对应行；最终确认使用名称和动作，不展示内部 ID。

### Step 1: 内容

- 分享说明。
- 入口和子工作流。
- 新建、重复导入或同谱系更新计划。
- 来源未验证状态和派生来源。

### Step 2: 风险与兼容

- 包格式、工作流 schema、必需能力和平台运行时。
- 敏感字段位置和高风险节点。
- 未包含的本地文件与 Automation。
- 缺少内置节点能力时提示升级 Synapse 后重新预检；格式保留 `installSourceId` 供未来可信外部能力安装器使用，当前导入向导不提供安装入口，导入本身不得静默安装。

### Step 3: 模型映射

- 按发送方供应商和实际模型分组，同一实际模型不因档位不同拆分。
- 一次映射批量作用于所有出现位置。
- 保持继承工作流默认和节点显式指定的关系。
- 只有谱系历史映射和本地唯一实际模型匹配可以自动完成。
- 同名、档位和本地默认只能作为用户显式选择；没有唯一候选时必须选择具体模型，或针对发送方明确选择“使用本地默认”。
- 只有全部来自历史确认或唯一实际模型匹配时才跳过本步骤。

### Step 4: 项目映射

- 每个发送方项目独立映射，多个来源可以指向同一本地项目。
- 保持工作流默认项目和节点显式项目的继承关系。
- 依次复用谱系映射、匹配 Git 远端哈希指纹、按项目类型与唯一名称预选。
- 分享包不包含发送方本地路径、Git 远端地址或凭据。

### Step 5: 外部依赖

- 本地文件和目录。
- Drive 文件、目录和固定版本。
- staged 临时资源。
- Codex / Claude Code 的 profile、settings、MCP 配置路径、工作目录和附加目录。
- 显式 shell 及未来节点声明的其它环境依赖。

稳定分组必须跨同一谱系修订保持一致，优先复用已确认映射；新出现、失效或不兼容的依赖才需要重新选择。

### Step 6: 确认

- 新建、原地更新、内部调用重写和子工作流清理。
- 将被禁用的本地 Automation 和不兼容参数预设提示。
- 保留的运行历史、创建的撤销点和备份范围。
- 最终模型、项目、文件及运行时替换摘要。
- 活动运行、活动编辑和预期修订冲突检查。

提交前重新读取分享包并验证摘要，重新检查本地依赖、活动状态和所有预期修订。任何变化都返回对应步骤，不允许部分提交。

## Dependency behavior

| 依赖 | 导出 | 导入 |
|---|---|---|
| 模型 | 记录供应商显示信息、实际模型、档位和出现位置 | 按组映射到本地具体模型，低置信度必须确认 |
| 项目 | 记录名称、类型和可选 Git 指纹，不记录路径 | 多对一映射，保持显式与继承关系 |
| 本地文件 / 目录 | 不携带字节，列出位置并提示另行转交 | 必填映射到同类型本地资源 |
| Drive | 不携带字节 | 有权限且固定版本存在时沿用，否则当前版本映射到同类型本地资源；未来 Drive 选择器可扩展为映射其它 Drive 资源；固定版本不得变成最新版 |
| staged | 不复用临时身份 | 当前版本必须映射到稳定本地资源；未来 Drive 选择器可扩展为 Drive 资源 |
| inline file | 当前版本阻止导出 | 未来只能由显式附件能力支持 |
| 显式 shell | 声明 `runtime.shell.*` 必需能力 | 检测实际可执行能力，缺失时阻止；不得自动改写脚本语义 |
| 未指定 shell | 不声明平台要求 | 继承接收方本地默认 |
| 显式环境配置 | 只声明配置类型、兼容要求和非敏感提示，不携带凭据 | 兼容配置可以沿用；不可用时必须选择替代项或明确选择“使用本地默认”，不得静默删除或降级 |
| 未指定环境配置 | 不创建额外映射 | 继承接收方本地默认 |
| Automation | 只提示关联数量，不打包 | 不创建；原地更新时重新校验已有绑定 |
| 参数预设 / 上次运行值 | 不打包 | 保留本地值，不兼容时提示并在使用时要求修正 |
| 运行历史 | 不打包 | 原地更新和撤销始终保留 |

脚本文本内部的命令、路径和平台语法不做启发式阻断，只提示人工确认；节点配置中的结构化路径必须由节点契约声明为外部依赖。

当前工作流变量只来自参数、节点输出和静态值，它们属于包内工作流语义，不新增全局变量、项目变量或密钥变量映射步骤。未来新增跨环境变量来源时，必须通过节点或工作流分享契约、required capability 和相应版本升级显式引入。

## Node share contract

`NodeManifest` 必须包含分享契约。契约可以使用声明式字段和纯函数，但不得进行文件、网络、数据库、权限或 UI 操作。

契约至少表达：

- 节点是否自包含。
- 节点运行所需 capability ID 与最低版本。
- 模型、项目、子工作流和其它对象引用。
- 本地、Drive、staged 和 inline 资源位置及资源类型。
- 敏感字段位置和高风险权限。
- 显式配置与继承配置。
- 导入映射应用和内部 ID 重写规则。
- 不可移植错误与提示。

中央分享服务负责遍历、去重、生成稳定引用键、聚合 required capabilities、读取或写入文件、权限审计、归档、生成导入计划、事务提交和恢复。节点不得自行创建包，也不得降低中央安全策略。

新增节点或 App Capability 工作流节点时，即使完全自包含也必须显式声明分享契约；契约注册测试必须覆盖全部已注册节点。

## V4 container

### File form

- 扩展名：`.synapse-workflow`
- 容器：ZIP
- 格式名：`synapse-workflow-package`
- 格式版本：`4.0.0`
- 新导出只生成 V4；旧 V1/V2/V3 JSON 继续导入。
- 文件扩展名只用于选择器和系统关联，读取时以内容和 manifest 校验为准。

### Archive layout

```text
manifest.json
workflows/<stable-workflow-ref>.json
workflows/<another-stable-workflow-ref>.json
```

当前 V4 不包含 `assets/`。未来附件、签名或 namespaced extension 文件只有在 manifest 明确声明、文件摘要存在且对应 capability 允许时才能出现。任何未声明文件都拒绝导入。

`manifest.json` 是固定且唯一的控制条目，不进入自身的 `files` 清单，避免摘要自引用。除它以外，ZIP 中的全部条目必须与 `files` 一一对应；每个清单项都必须校验大小和 SHA-256。

### Manifest shape

以下为协议字段边界，实际 TypeScript schema 应放在工作流分享模块的共享类型中：

```ts
type WorkflowShareManifestV4 = {
  format: "synapse-workflow-package"
  formatVersion: string // V4 writer 当前固定输出 4.0.0；reader 按 SemVer 兼容规则判断
  artifactId: string
  lineageId: string
  exportedAt: string
  createdWith: {
    appVersion: string
    platform?: "darwin" | "win32" | "linux"
  }
  derivedFrom?: {
    lineageId: string
    artifactId?: string
  }
  shareNote?: string
  entrypoints: string[]
  workflows: Array<{
    ref: string
    sourceWorkflowId: string
    sourceRevision: string
    schemaVersion: string
    path: string
  }>
  references: {
    models: ModelReference[]
    projects: ProjectReference[]
    resources: ResourceReference[]
    runtimes: RuntimeReference[]
  }
  requiredCapabilities: Array<{
    id: string
    minVersion: string
    installSourceId?: string
  }>
  risks: {
    sensitiveLocations: FieldLocation[]
    highRiskLocations: FieldLocation[]
    portabilityWarnings: DiagnosticLocation[]
    excludedAutomationCount: number
  }
  files: Array<{
    path: string
    size: number
    sha256: string
    mediaType: string
  }>
  extensions?: Record<string, unknown>
  signatures?: SignatureEnvelope[]
}
```

`entrypoints` 和所有 occurrence 使用包内稳定 `ref`，不得依赖数组序号。引用键必须由来源依赖身份确定性生成，使同一谱系的新修订可以复用映射；路径或身份真实变化时生成新引用并要求重新映射。

`schemaVersion` 必须与对应工作流文档的 `meta.schemaVersion` 一致，`sourceRevision` 必须与文档保存时生成的修订标识一致，否则拒绝。工作流正文保持完整，不把分享依赖声明写回正文。

## Compatibility

包格式版本、工作流 schema 版本、工作流修订哈希、DataRepository schema 版本和 capability 版本相互独立。

### Package format

- major：容器、manifest 必需结构、安全语义或已有字段含义发生不兼容变化。
- minor：新增可忽略显示元数据、可选扩展结构或由 `requiredCapabilities` 明确保护的新能力。
- patch：不改变协议语义的规范化、校验或序列化修正。

当前导入器可以接受同 major 的更高 minor / patch，前提是所有 required capabilities 都受支持。未知必需 capability 必须阻止导入；未知可选显示元数据可以忽略。不能用裁剪节点、字段、附件或签名要求的方式降级导入。

### Workflow documents

每个包内工作流都必须独立经过 `workflow-document-migration.ts`。无版本文档按 `0.0.0`；迁移在内存克隆上执行，全部文档成功并完成最终结构和关系校验后才进入导入计划。

共享 `VersionedDataMigrator` 只用于单个工作流文档的同步内存迁移。ZIP 解析、V1/V2/V3 transport adapter、capability 检查、引用重写、事务、备份和 IO 不得塞进迁移器。

V1/V2/V3 先由只读 transport adapter 转成统一导入计划，再走当前校验和映射流程；已发布 adapter 与历史 fixture 不得原地改写。

### Future workflow documents

高于当前支持 schema 的未来工作流继续使用专用原文 JSON 导出路径，不解释、不迁移、不裁剪，也不伪装成可正常导入的 V4 分享包。

## Lineage and updates

- 每次新来源导出创建稳定 `lineageId`；每次导出创建新的 `artifactId`。
- 同一 artifact 重复导入，或同一 lineage 的工作流来源修订集合完全相同，都是幂等操作，直接显示已导入结果。
- 用户删除已导入结果后可以重新导入。
- 同一 lineage 的新修订把发送方视为权威，原地覆盖接收方已保存定义，不检测、不合并本地修改。
- 映射优先复用；只要求处理新增、失效或不兼容项。
- 导入工作流再次导出时创建新 lineage，并用 `derivedFrom` 关联原来源；保持原 lineage 应直接转发原文件。

新版移除的子工作流：

- 无谱系外引用且无运行历史：自动清理。
- 有谱系外引用或运行历史：解除谱系关系并保留。
- 入口工作流不因包结构更新自动删除。

原地更新保留运行快照和参数预设。参数预设不兼容时只提示；关联 Automation 使用新版参数重新校验，兼容项保持不变，不兼容项在最终确认中列出并随事务禁用、标记需要更新，配置和运行历史保留。

### One-step undo

每个 lineage 只保留最近一次成功更新前的完整撤销点：

- 导入失败自动回滚，不需要用户操作。
- 成功后可以撤销工作流定义、被清理子工作流、来源关系、映射和被禁用 Automation 状态。
- 工作流和 Automation 运行历史不回滚、不删除。
- 只有相关工作流仍处于刚导入修订时允许撤销；后续保存会阻止撤销。
- 下一次成功更新替换旧撤销点。

这不是通用工作流编辑版本历史。

## Concurrency

最终提交前必须检查：

- 待更新或清理的工作流是否正在运行。
- 它们是否位于任一活动工作流或 Automation 运行的递归调用链中。
- 编辑器是否存在未保存修改或正在保存。
- 工作流、Automation、谱系状态和包文件是否仍匹配预检时的修订或摘要。

存在活动运行时提示等待或由用户自行取消；导入不得自动取消。存在活动草稿时提示先处理编辑窗口；不得自动丢弃。干净编辑器在导入后自动刷新。

工作流保存必须增加预期修订校验，避免外部更新后旧编辑器再次保存覆盖。

## Deletion

- 所有工作流删除先扫描反向工作流调用；存在引用时阻止并列出引用方。
- 删除导入入口时默认勾选清理同 lineage 内无外部引用、无运行历史的子工作流。
- 有引用或历史的子工作流解除 lineage 并保留。
- 删除单个子工作流不级联其它内容。
- lineage 最后一个成员消失后删除来源状态和模型、项目、文件映射。
- 整组删除原子提交；失败不留下半删状态。

## Persistence and transaction boundary

分享来源、映射、事务恢复和撤销状态保存在工作流正文之外。映射包含本地项目 ID 和路径，不得写入工作流文档、manifest 或日志；其本地存储保护不得弱于工作流正文，撤销状态包含工作流敏感字面值时必须避免进入非预期导出面。

当前 JSON backend 缺少跨 namespace 的原子新增、覆盖和删除事务。实现必须提供专用分享导入事务协调器：

1. 生成完整导入计划和所有 next-state。
2. 保存并校验受影响状态的恢复快照。
3. 写入持久化事务日志，记录预期摘要和阶段。
4. 按受控顺序提交工作流、Automation、谱系和映射状态。
5. 成功后标记完成并生成一个撤销点。
6. 任一步失败或应用崩溃后，在启动恢复中回到完整 old-state 或完成完整 new-state，不暴露半提交状态。

不得循环调用 `WorkflowService.save()` 实现整组导入，也不得把跨存储事务职责放进 `VersionedDataMigrator`。

## Security

- 复用现有安全 ZIP 读取能力：拒绝路径穿越、绝对路径、符号链接、重复条目、加密条目、未知压缩方式、CRC 错误和压缩炸弹。
- 文件数、单文件大小、压缩后大小、解压总量、压缩比、工作流数、依赖 occurrence 数和解析时间均使用 `desktop/config.ts` 中带中文注释的集中限制；这些是实现安全策略，不属于包格式版本。
- ZIP writer 只写服务生成的固定路径，目标文件原子落盘。
- 除固定且唯一的 `manifest.json` 控制条目外，manifest 必须声明全部文件、大小、媒体类型和 SHA-256；缺失、重复、摘要不符、清单外条目或额外 manifest 条目均拒绝导入。
- 包摘要保证内容自洽，不证明作者身份；无可信签名时显示“来源未验证”。
- 当前不引入自签设备身份；格式预留基于制品摘要的签名。声明签名为必需能力但无法验证或验证失败时阻止导入。
- 分享包不携带节点代码、插件、可执行文件、安装脚本或任意下载 URL。
- 导入不会自动运行；后续运行继续走现有权限、审计和敏感日志边界。
- 打开预检到提交之间重新读取并验证包摘要，防止 TOCTOU。
- manifest、日志和审计只记录敏感字段位置、计数和摘要，不复制敏感值或完整本地路径。

## Service boundaries

建议将现有 `WorkflowPackageService` 演进为中央分享服务，并按职责拆分：

- V1/V2/V3 JSON transport readers。
- V4 ZIP reader / writer 和 manifest schema。
- dependency graph collector。
- node share contract registry。
- export preflight and artifact builder。
- import plan builder and mapping suggester。
- lineage / mapping / undo state service。
- import transaction coordinator and startup recovery。

Renderer 不解析 ZIP、不扫描节点 config、不应用映射、不生成 ID、不做文件 IO，也不直接写 DataRepository。

## Implementation sequence

1. 定义 V4 manifest、稳定引用、节点分享契约和全注册表契约测试；保留 V1/V2/V3 fixture。
2. 实现递归导出预检、安全 ZIP writer、摘要和导出面板。
3. 实现 V4 reader、六步导入计划、模型/项目/资源映射和兼容检查。
4. 实现 lineage 状态、原子事务、启动恢复、一层撤销、运行/编辑并发锁和安全删除。
5. 接入 Automation / 参数预设兼容检查，更新 Workflow MCP / 系统 Skill 指南（如功能入口或 schema 发生变化），补齐测试和发布说明。

## Test matrix

至少覆盖：

- 单入口、共享子依赖、菱形依赖、缺失依赖、循环和超深调用。
- 同一实际模型跨档位分组、多个 occurrence 批量映射、映射复用与档位回退。
- 多项目、多对一项目映射、Git 指纹、显式与继承项目关系。
- local / Drive / staged / inline file 四类资源。
- 敏感字面值原样在工作流正文中、但不泄漏到 manifest、日志和 UI 值展示。
- 必需 capability 缺失、可信能力安装后重新预检、未知 optional metadata。
- V1/V2/V3 adapter 和 V4 同 major 高 minor / patch。
- ZIP 穿越、符号链接、重复条目、未声明文件、摘要错误、压缩炸弹和 TOCTOU。
- 同 artifact 幂等、同 lineage 更新、删除后重导、派生导出。
- 子工作流移除后的清理与解除关系。
- 五节点旧运行历史在三节点更新后仍按旧结构展示。
- Automation 兼容保留、不兼容禁用、参数预设保留。
- 活动运行、递归调用链、Automation 运行、脏编辑器、保存竞态阻断。
- 提交中每个阶段失败和模拟崩溃后的 old-state / new-state 恢复。
- 一层撤销成功、后续保存后撤销阻断、运行历史不回滚。
- 删除反向引用保护和整组原子清理。

## Acceptance criteria

- 发送方可以从列表或编辑器导出一个 `.synapse-workflow` 文件。
- 接收方通过最多六个固定步骤完成导入，只有真实需要处理的步骤出现。
- 在模型供应商、模型名称、项目 ID 和本地路径不同的环境中，所有可映射依赖都被明确替换。
- 子工作流、显式/继承关系和运行历史语义保持正确。
- 缺少必需能力或外部资源时不会生成看似成功但无法复现的工作流。
- 重复包不产生副本；同 lineage 新修订安全原地更新且可撤销一步。
- 任一失败、并发变化或崩溃都不产生半导入、半删除或静默数据丢失。
- 后续新增节点、资源、附件或可信签名时，可以通过节点契约、required capabilities 和兼容版本规则扩展，不需要重新设计容器。
