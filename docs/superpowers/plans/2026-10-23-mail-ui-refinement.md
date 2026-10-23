# 邮箱体验调整 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前分支逐项实施。用户已确认方案和手动保存/关闭行为，不再重复请求批准。

**Goal:** 精简列表工具栏、修复阅读与选中状态，并将写信改为独立窗口和手动保存。

**Architecture:** 沿用 mail 核心服务与 System App 窗口管理器；写信窗口由同一 mail App 的私有打开参数区分，不新增 App。未保存编辑与持久草稿分离，首次保存通过私有 IPC 固定用户编辑及源邮件关联，公开 MCP 草稿契约保持不变。

**Tech Stack:** Electron / React / TypeScript / shadcn Radix Nova。

**Spec:** 本对话已确认的六项修改方案；原 `docs/superpowers/specs/2026-10-23-mail-client-design.md` 中侧栏写信和自动保存由本方案替代。

## Global Constraints

- 当前分支原地开发；不新增依赖、不启动应用、不推送；不包含既有两个无关改动。
- 保留两栏/三栏响应式布局；保留邮件隔离、权限、发送幂等及 unknown 核验。
- 手动保存；关闭未保存内容时保存/放弃/取消；空白新信关闭不留草稿。

## Review Focus

- 回复准备未完成时关闭窗口及迟到响应不得生成草稿或恢复 UI。
- 首次保存期间继续输入，保存回执不得覆盖新内容。
- 已有草稿放弃修改不改变原版；身份切换不泄露旧内容。
- 输入图片不隐式保存，显示仍使用受控资产。
- 搜索不完整仍有状态入口，批选不换行。

### Task 1: 列表与账号向导

**Files:** `desktop/src/modules/mail/account-dialog.tsx`, `layout.tsx`, `message-list.tsx`, 新建 `list-toolbar.tsx`。
**Interfaces:** toolbar 消费选择数量、搜索及 coverage；MailList 保持批量操作接口。
- [x] 添加交互回归：切换搜索、含正文、100 项批量上限、单菜单。
- [x] 合并等高工具栏、整行背景；使用 Field 单选块；高级设置右对齐。
- [x] 运行 `pnpm --filter @synapse/desktop exec vitest run src/modules/mail`。

### Task 2: 阅读容器

**Files:** `message-detail.tsx`, `app-capabilities/mail/renderer/sanitize-body.ts` 及对应测试。
**Interfaces:** 隔离 HTML 输出保持无脚本无同源；唯一可信基础排版样式。
- [x] 添加正文排版与安全清洗测试，确认旧实现失败。
- [x] 附件前置，HTML 阅读区填满可用高度，信息头紧凑。
- [x] 运行 mail renderer 与 reading 测试。

### Task 3: 独立写信与手动保存

**Files:** `use-compose.ts`, `compose.tsx`, `compose-window.tsx`, `index.tsx`, `use-compose-editor.ts`, `system-app-window-service.ts`, mail private schema/bridge/ipc/service/drafts。
**Interfaces:** MailOpenRequest.compose 携带严格 ComposeIntent；draft.prepare 不写草稿，draft.commit 首次显式保存；现有 draft.update 保持 CAS。窗口关闭复用 beforeunload 拦截和三选确认。
- [x] 将自动保存/导航保存测试替换为不自动保存、保存失败保留、取消加载、首次保存及关闭选择测试；先运行确认失败。
- [x] 接入独立窗口、首次准备与显式保存、图片读取、保存/放弃/取消。
- [x] 验证窗口复用不会替换未保存内容，准备失败可重试。
- [x] 运行 mail 全部专项、窗口服务专项、desktop typecheck、hard constraints 和 IPC codegen 检查。

### Task 4: 文档与交付

- [x] 同步原设计、module boundaries、能力清单及权威 Skill 使用说明；公开工具数量不变。
- [x] 更新 RELEASE_NOTES_PENDING.md。
- [x] 独立代码审查，修复必要发现，检查聚焦 diff 并本地提交。

## 完成记录

- 按已确认方案完成全部四项；公开邮箱工具保持 44 项，新增四个 UI 专用 IPC，无依赖/分支/工作树变更。
- 独立审查发现并修复首次保存期间导入丢失、草稿窗口复用、租约阻断过期维护；复审补齐“另存为新草稿”与原草稿窗口定位分离。以上均先添加失败回归，再实现修复。
- 最终专项：41 个文件、208 项测试通过（mail UI/核心、站内信匹配回归、窗口服务、Apps IPC、共享顶栏架构）。desktop typecheck、IPC codegen、hard constraints、UI tracking coverage 通过；git diff whitespace 检查通过。
- 未启动应用、未运行真实邮件收发或原生窗口视觉验收。仍须实机核对窗口外观、系统关闭事件、深浅主题和截图对照。
