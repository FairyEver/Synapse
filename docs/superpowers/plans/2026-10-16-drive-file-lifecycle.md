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
- 首次 dashboard 全量 Node 套件的 5 个失败文件已在后续排错中修复：浏览器 Hook 测试归入现有 Chromium 套件，渲染测试补齐 jsdom、QueryClientProvider 和分享路径，版本与遥测测试保留真实 API 导出，格式与路由断言对齐已生效的产品契约。
- 首次 lint 的 6 处错误已修复：删除未使用 import，上传错误保留 cause 与脱敏边界，下载请求继续隔离本地路径，preload 使用自己的 TypeScript 项目进行 ESLint 检查。
- 后续排错运行现有 Chromium 自动化套件；没有启动产品应用或人工操作浏览器，跨设备真实同步与视觉验收仍未执行。

- 收尾时检测到并行任务的开发端口/构建脚本修改；保持原样，提交仅按本任务路径白名单选择。

## 补充全量验收（2026-10-16）

- 网页 Node 全量：`pnpm --dir dashboard exec vitest run --config vite.config.ts --maxWorkers=1`，108 文件、918 项通过。
- 网页 Chromium 全量：`pnpm --dir dashboard run test:browser`，10 文件、42 项通过；包含原样迁移的 17 项表格 URL Hook 测试。
- 桌面云盘主进程与界面分开运行：19 文件、620 项及 11 文件、253 项通过，合计 873 项；包含能力分发、共享 schema、IPC/preload、存储 schema、上传和同步异常路径。
- 服务端云盘全量：`pnpm --filter @synapse/server exec vitest run src/drive --maxWorkers=1`，40 文件、751 项通过。
- 桌面 Renderer、Electron、preload、测试四个 TypeScript 项目及服务端类型检查通过；网页生产构建（包含 shared 构建与 TypeScript）通过。
- 云盘改动的 26 个桌面生产文件及本轮修改的 IPC 测试，ESLint 共 27 文件通过；hard constraints、桌面交互日志及网页 Drive 遥测覆盖检查通过。
- 上传错误 cause 回归已验证旧实现失败、修复后通过；脱敏消息与 audit 保持原契约，下载请求不发送本地 outputPath。
- 高并发验收曾使 300 行版本分页与 1000 文件上传边界超时，隔离复现及最终串行全量均通过；未缩小数据、放宽超时、删除断言或跳过测试。
- 独立只读复查无阻断项。Chromium 仍有既有 MDXEditor 渲染期间状态更新警告，构建仍有大 chunk 提示；本轮没有改变编辑器或打包策略。未运行跨设备人工验收。
