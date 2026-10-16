# 云盘文件生命周期改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; independent backend, desktop renderer and dashboard edits may use superpowers:dispatching-parallel-agents. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 统一用户与 AI 的文件新版本、同步关系退出及重新映射流程。

**Architecture:** 复用当前版本化上传、DriveSyncService、PermissionGuard/AuditSink 与 shadcn。后端提供预览及提交契约，Renderer 和 MCP 共享执行服务。按文件所有权并行，主代理负责集成与验证。

**Tech Stack:** Electron、React、TypeScript、NestJS、Vitest、pnpm。

**Spec:** `docs/superpowers/specs/2026-10-16-drive-file-lifecycle-design.md`

## Global Constraints

- 当前目录、当前分支；不新建 worktree 或分支，不添加依赖，不启动应用。
- 同扩展名替换保留 itemId、云端名称和链接；现有文本补丁保护继续有效。
- 可恢复删除、排除项保护、显式预览及执行时复验不可弱化。
- 使用已有主题组件，禁止自定义颜色、内联样式、无必要文案。
- 用户已明确要求完整实施，本计划作为实施记录继续执行，不重复请求授权。

## Review Focus

- 云端或本地在预览后改变、并发提交及目标改名移动必须拒绝过期决定。
- 随父文件夹同步的文件和暂停关系不得漏检、误恢复或丢弃本地修改。
- 解除后另一端保留，排除项、额外内容及重建文件不被重试误删。
- 部分成功和替换后验证失败必须报告实际结果，不能二次生成版本或误报同步完成。
- 紧凑列表的键盘、弹层事件、错误与筛选稳定性必须保留。

### Task 1: 后端与 AI 契约

**Files:** `shared/src/drive.ts`、`desktop/electron/services/`、`desktop/electron/modules/`、bootstrap/preload/bridge、Drive MCP domain/dispatcher、`server/src/drive/` 及相应测试。

**Interfaces:** 产出 `drive.file.replace.preview/apply` 和 `driveSync.previewRemoval/removeBinding` 类型化 bridge。disposition 为 keep_both/keep_local/keep_remote/delete_both，默认 keep_both；具体输出与 renderer 工作者直接核对。

- [x] 建立覆盖、并发与解除异常路径的失败测试。
- [x] 实现共享预览/提交服务，修复 expectedItemId，更新 IPC 与 MCP。
- [x] 运行后端专项测试，记录结果。

### Task 2: 桌面交互

**Files:** `desktop/src/modules/drive/` 与相应 renderer 测试。

**Interfaces:** 消费 Task 1 的 bridge；hook 负责请求与状态，弹窗负责渲染。

- [x] 建立上传新版本、解除选择、列表/弹层及直接重映射的交互测试。
- [x] 实现文件入口与预览，压缩同步列表，补齐四种解除去向与直接编辑入口。
- [x] 运行 renderer 专项测试。

### Task 3: 网页与发布反馈

**Files:** `dashboard/src/features/drive-console/` 及 API、相关测试。

**Interfaces:** 使用已有版本列表及 prepareUpload 的 expectedItemId/expectedVersionId；不使用桌面本地路径工具。

- [x] 建立显式替换和过期版本请求测试。
- [x] 实现同扩展名新版本入口与目标版本锁定，保留 Site 重新发布语义。
- [x] 运行 dashboard 专项测试和类型检查。

### Task 4: 集成、指南与完成验证

**Files:** Drive 权威 Skill 包、`docs/agents/capability-registry.md`、module boundaries、同步规格和 `RELEASE_NOTES_PENDING.md`。

- [x] 核对实现、MCP、Skill/API 和注册数量，更新规则与发布说明。
- [x] 运行完整相关专项测试、类型检查、hard constraints 和 diff 检查。
- [x] 独立复查数据损失、过期确认与部分失败路径，修复发现。
- [x] 检查暂存区，仅本地提交本任务文件；不 push。


## 实施与验证记录

- 后端、桌面 Renderer、dashboard 按文件所有权完成并行实现；整个任务保持当前 main 与当前目录，无 worktree、切换分支、发布或 push。
- 普通桌面上传和拖拽的同名文件也走新版本预览；本地上传 IPC 转交受控替换回调，新文件使用 createOnly，文件夹根锁定身份。重试不复用旧令牌。
- 删除前使用已审阅的时间戳和文件版本，空目录要求原子空检查；创建、上传、移动在事务内锁定并复验父目录，避免并发内容落入已删除目录。
- 独立复查发现并修复三项问题：删除使用二次读取的未审阅时间戳、空目录删除与并发移入的竞争、100 个预览令牌限制。相关回归测试均红绿验证。
- 确认令牌绑定逻辑同步状态；固定版本回读后复验当前云端版本，提交后验证失败保持关联暂停并报告已提交事实。
- 桌面相关 29 个测试文件、866 项通过；最后新增桌面 Site 状态后重跑两个受影响文件，209 项通过（包括新增一项）。服务端 4 文件、305 项通过；dashboard 7 文件、147 项通过。
- desktop 完整 typecheck、server TypeScript、dashboard TypeScript、hard constraints、桌面与网页交互日志覆盖检查通过。最后的桌面 Site 展示补充也已通过 Renderer 与测试类型检查。
- dashboard 全量 Node 套件存在 5 个已有失败文件（Browser Mode 环境、旧 API mock、格式断言、删除路由断言、SSR 环境）；版本弹窗与 SSR 已以 HEAD 源码复测得到相同失败。相关新增/修改测试全部通过。
- 改动文件的 lint 检查发现现有未修改代码的问题：bootstrap 的未使用 import、旧 IPC 错误缺 cause、旧下载函数未使用变量，以及 preload 未纳入 ESLint tsconfig。新增 Renderer 代码的针对性 lint 通过。不为此重构无关代码。
- 未启动应用或浏览器；跨设备真实文件同步与视觉验收没有在本轮运行，源码、权限/异常路径、交互和类型以自动化测试覆盖。

- 收尾时检测到并行任务的开发端口/构建脚本修改；保持原样，提交仅按本任务路径白名单选择。
