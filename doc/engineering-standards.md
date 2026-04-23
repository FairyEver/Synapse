# Synapse 工程规范与 AI 编码约束

## 1. 目的

本规范用于约束 Synapse 项目的代码编写、目录组织和 AI 产出方式，目标是让新增代码持续满足以下要求：

- 安全
- 可维护
- 可扩展
- 风格统一
- 符合 Electron + React + Tailwind CSS + shadcn/ui 的实践边界
- 不引入短期可用、长期难维护的实现

当前仓库的核心技术栈：

- Electron
- React
- Tailwind CSS
- shadcn/ui（Radix base）
- TypeScript

## 2. 当前仓库上下文

这份规范必须以仓库现状为准，而不是照搬抽象模板。

仓库是 pnpm monorepo，所有源码在 `desktop/` 子包（`@synapse/desktop`）下。共享文档（`doc/`、`AGENTS.md`、`CLAUDE.md`、`README.md`）和 CI（`.github/`）留在仓库根目录。

当前实际结构包括：

- `desktop/electron/`：主进程与 preload
- `desktop/src/app-shell/`：应用壳层上下文与顶层编排
- `desktop/src/components/`：共享 UI
- `desktop/src/components/ui/`：shadcn/ui 组件源码
- `desktop/src/modules/`：业务模块
- `desktop/src/lib/`：纯工具函数
- `desktop/src/types/`：共享类型

重要说明：

- 本仓库当前使用 `desktop/src/modules/` 作为业务模块目录。
- 外部文档里提到的 `features/` 在 Synapse 当前语境下应理解为 `modules/`。
- 未经明确重构任务，不要在现有 `desktop/src/modules/` 旁边再引入一套 `desktop/src/features/` 平行结构。

## 3. 总原则

### 3.1 先结构，后实现

任何功能都必须先遵守既有分层、目录和边界，再开始写实现。不得为了快而跨层直接调用。

### 3.2 默认保守，不炫技

除非任务明确要求，否则不要主动做以下事情：

- 自创复杂抽象
- 提前过度泛化
- 引入新依赖
- 写“聪明但难懂”的代码
- 顺手重写与任务无关的结构

### 3.3 小步修改

每次改动应尽量小而清晰：

- 一个功能点一组改动
- 一个组件一个职责
- 一个任务只解决一个主要问题

### 3.4 优先复用现有约定

如果仓库中已经有可复用模式，必须优先复用，不得另起一套。

## 4. 分层边界

Synapse 必须坚持三层边界：

### 4.1 Electron 主进程层

负责：

- 窗口创建与系统事件
- 文件系统访问
- Git 操作
- 下载与安装
- 系统对话框
- 更新检查

约束：

- 这类逻辑只能放在 `desktop/electron/` 下的主进程代码中。
- 随着功能增长，应拆出清晰的主进程服务文件，而不是持续堆在 `desktop/electron/main.ts`。

### 4.2 Preload 桥接层

负责：

- 暴露有限、安全、类型化的 API
- 只提供渲染层真正需要的能力
- 屏蔽底层 Electron 与 IPC 细节

约束：

- 不直接暴露完整 `ipcRenderer`
- 不暴露“什么都能调”的通用桥
- 必须通过白名单 API 暴露最小必要能力

### 4.3 React 渲染层

负责：

- 页面显示
- 用户交互
- 状态管理
- 通过 preload API 调用受控能力

约束：

- 不直接访问 Node API
- 不直接执行 Git 命令
- 不直接写文件系统逻辑
- 不直接 import 主进程能力
- 不使用 `window.require(...)`

## 5. 目录与模块组织

### 5.1 顶层建议

- `desktop/electron/`：主进程与 preload
  - `ipc/`：IPC 处理器
  - `services/`：主进程服务
- `desktop/src/App.tsx`：应用壳层编排与一级模块切换
- `desktop/src/app-shell/`：顶层状态与共享上下文
- `desktop/src/components/`：共享 UI 组件
- `desktop/src/components/ui/`：shadcn/ui 组件
- `desktop/src/hooks/`：共享自定义 hooks
- `desktop/src/modules/`：业务模块
- `desktop/src/lib/`：纯工具函数
- `desktop/src/types/`：共享类型
- `desktop/src/styles/`：全局样式

### 5.2 模块拆分

当前一类模块对应一个业务域，例如：

- `desktop/src/modules/rules`
- `desktop/src/modules/skills`
- `desktop/src/modules/settings`

模块内部建议按需要逐步拆为：

- `components/`
- `hooks/`
- `services/`
- `types.ts`
- `utils.ts`

### 5.3 共享代码位置

- 纯工具函数放 `desktop/src/lib/`
- 共享类型放 `desktop/src/types/`
- 业务私有逻辑优先留在对应模块内部
- 不要把模块细节泄露进共享组件层

### 5.4 App 壳层约束

`desktop/src/App.tsx` 应只承担：

- 顶层骨架
- 一级模块切换
- 壳层状态编排

不要让它继续增长成承载复杂业务逻辑的大文件。

## 6. Electron 规范

### 6.1 必须遵守

- `contextIsolation` 必须开启
- 不允许开启 `nodeIntegration`
- renderer 只能通过 preload 暴露的白名单 API 与主进程通信
- preload 只暴露最小必要、类型化的接口

### 6.2 责任划分

主进程负责：

- Git
- 文件系统
- 下载与安装
- 系统对话框
- 更新能力

preload 负责：

- 安全桥接
- API 收口
- 输入与返回结构的类型映射

renderer 负责：

- UI 与交互
- 状态流
- 调用桥接 API

### 6.3 默认禁止

- 在 React 组件中写文件系统逻辑
- 在 React 组件中执行 Git 操作
- 在 renderer 中 import Electron 主进程能力
- 向前端暴露原始 IPC 能力

## 7. React 规范

### 7.1 基本要求

- 只使用函数组件
- 组件和 Hooks 保持纯净
- 不在 render 阶段做副作用
- 副作用统一放到事件处理、`useEffect`、或专门的 service / hook 中
- Hooks 必须遵守 Rules of Hooks

### 7.2 页面与组件职责

- 页面或模块入口只做编排
- 复杂业务逻辑进入 service 或自定义 hook
- JSX 中不要塞复杂数据转换或长条件树
- 超过明显可读范围时及时拆组件

### 7.3 组件与 Hooks 边界

共享组件和 hooks 应尽量与业务解耦：

- `desktop/src/components/` 不应依赖具体业务模块实现
- `desktop/src/hooks/` 不应依赖具体业务模块逻辑
- 业务模块可以依赖共享组件和 hooks
- 业务模块之间不要直接耦合实现细节

## 8. Tailwind 与 shadcn/ui 规范

### 8.1 Tailwind 使用原则

Tailwind 主要用于：

- 布局
- 间距
- 尺寸
- 响应式
- 滚动
- 轻量排版

推荐优先使用的类别：

- `flex` `grid` `block` `hidden`
- `gap-*` `p-*` `px-*` `py-*` `m-*`
- `w-*` `h-*` `min-h-*` `max-w-*`
- `items-*` `justify-*`
- `overflow-*`
- `rounded-*`
- `text-sm` `text-base` `text-lg` `font-medium` `font-semibold` `truncate`
- `sm:` `md:` `lg:` `xl:`

默认不要主动添加：

- 大量颜色类
- 大量阴影类
- 渐变类
- 动画类
- 纯装饰性 absolute/fixed
- inline style

### 8.2 shadcn/ui 使用原则

- 优先复用现有 shadcn/ui 组件
- 默认保留 shadcn/ui 的基础视觉风格
- 视觉基线以 `doc/DESIGN.md` 为准（当前为 `radix-nova` preset、Radix primitive）
- 业务 UI 优先通过组合已有组件完成
- 不要为了”更好看”随意改组件内部实现
- 需要新 UI 原子组件时，优先新增到 `desktop/src/components/ui/`，不要先在 `desktop/src/components/` 手搓一个平行版本
- 不要重新引入 `@base-ui/react` 或把项目切回 Base UI 路线，除非任务是用户明确要求的迁移
- 新增或重装 shadcn 组件时，必须保留当前 Radix 基线；如果需要重新初始化或批量重装，显式使用 `--base radix`
- 默认决策顺序应为：现有业务组合组件 -> `desktop/src/components/ui/` 现有组件 -> 新增 shadcn 组件 -> 模块内薄组合组件 -> 最后才是自定义 primitive

优先使用的组件包括：

- `Button`
- `Card`
- `Input`
- `Textarea`
- `Label`
- `Dialog`
- `Sheet`
- `Tabs`
- `DropdownMenu`
- `Tooltip`
- `Badge`
- `ScrollArea`
- `Separator`

### 8.3 当前项目的额外护栏

- 当前应用壳层应与共享 shadcn 基线保持一致，不要在业务模块里扩散额外装饰性样式
- 功能页面默认追求简洁、清晰、易维护，而不是“重新设计一遍”
- 如果一个 UI 需求可以通过 shadcn/ui 组件完成，就不要用多层裸 `div` 手搓平行实现
- Tailwind 默认主要承担布局、间距、尺寸、响应式和轻量排版，不应成为按钮、输入框、卡片等表面视觉的主要实现方式

## 9. TypeScript 与类型规范

### 9.1 基本要求

- 使用严格类型
- 不允许随手使用 `any`
- 优先定义明确的 `interface` 或 `type`
- IPC 请求和响应必须类型化
- 配置文件结构必须类型化

### 9.2 类型位置

- 共享类型放 `desktop/src/types/`
- 模块私有类型放对应模块内部
- preload 暴露到 `window` 的能力必须同时更新全局类型声明

### 9.3 函数约束

- 每个公共函数必须有明确参数和返回值
- 异步函数返回 `Promise<T>`
- 不要让函数隐式返回结构不清晰的数据

## 10. 状态管理规范

### 10.1 原则

- 局部状态优先使用 React state
- 跨组件共享状态才考虑 context
- 不要过早引入重型状态管理库

### 10.2 推荐顺序

- 页面局部：`useState`
- 派生逻辑：`useMemo`
- 副作用：`useEffect`
- 复杂局部流程：`useReducer`
- 少量跨模块共享状态：`context`

### 10.3 禁止

- 把所有状态都提升到顶层
- 用全局 store 解决所有问题
- 组件里既读文件又管 UI 又做数据转换

## 11. 命名与规模约束

### 11.1 文件命名

- React 组件：`PascalCase.tsx`
- hooks：`useXxx.ts`
- services：`xxx.service.ts`
- utils：`xxx.ts`
- types：`xxx.types.ts` 或 `types.ts`

### 11.2 变量命名

- 布尔值：`isXxx` `hasXxx` `canXxx`
- 事件函数：`handleXxx`
- 纯动作函数：`createXxx` `loadXxx` `installXxx`

避免模糊命名：

- `data`
- `info`
- `temp`
- `obj`
- `arr`
- `item2`

### 11.3 文件与函数规模

建议：

- 单个组件文件尽量不超过 200 到 250 行
- 单个 service 文件尽量不超过 300 行
- 单个函数尽量不超过 40 到 60 行
- JSX 超过 3 层明显嵌套时考虑拆组件

## 12. 错误处理与安全

### 12.1 错误处理

以下操作必须有明确错误处理：

- 读取配置
- 仓库 clone / pull
- 创建 PR
- 生成下载包
- 安装到目录
- 解析配置与元数据

错误信息应同时满足：

- 对用户可理解
- 对开发可追踪
- 不能只 `console.log(error)`

### 12.2 错误分类建议

- 用户输入错误
- Git / 网络错误
- 文件系统错误
- 配置错误
- 未知错误

### 12.3 安全要求

- 所有文件写入必须先做路径规范化与校验
- 不信任来自 UI 的任意路径拼接
- 不在 renderer 明文持久化敏感信息
- 不在日志中输出敏感内容

## 13. Codex 与其他 AI 的任务约束

### 13.1 固定约束

AI 在 Synapse 仓库中工作时必须遵守：

- 优先读取 `AGENTS.md`
- 遵守当前目录边界
- 保持 main / preload / renderer 职责清晰
- 优先复用已有模式
- 不主动加依赖
- 不无关重构
- 最终产出必须是最小可维护实现

### 13.2 单次任务补充模板

给 AI 下任务时，可以附加下面这段：

```md
Please follow the repository AGENTS.md strictly.

Task constraints:
- Do not introduce new dependencies.
- Do not redesign unrelated files.
- Reuse existing shadcn/ui components and existing project patterns.
- Keep Electron main/preload/renderer boundaries strict.
- Put business logic in services, not React components.
- Keep styles minimal and use Tailwind mainly for layout and spacing.
- Preserve current naming and file structure conventions.
- If a file or component becomes too large, split it.
- Add or update TypeScript types as needed.
- Handle errors explicitly.
- Return a minimal, maintainable implementation.
```

### 13.3 UI 任务附加模板

```md
UI constraints:
- Use shadcn/ui defaults as much as possible.
- Do not invent custom visual styles.
- Avoid gradients, heavy shadows, animations, and decorative absolute positioning.
- Prefer Card, Button, Input, Dialog, Tabs, DropdownMenu, ScrollArea, and Separator where appropriate.
- Use Tailwind only for layout, spacing, responsive behavior, and light typography.
- Keep className strings concise and readable.
```

### 13.4 Electron 任务附加模板

```md
Electron constraints:
- Do not expose raw ipcRenderer to the renderer.
- Expose only narrow, typed preload APIs.
- Keep privileged logic in main-process code.
- Validate file paths and inputs before filesystem writes.
- Do not move git or filesystem logic into React code.
- Respect contextIsolation and least-privilege design.
```

### 13.5 重构任务附加模板

```md
Refactor constraints:
- Do not change external behavior unless explicitly requested.
- Keep the diff small and focused.
- Prefer extraction over architectural rewrites.
- Preserve public interfaces unless there is a strong reason to change them.
- If you introduce a new abstraction, make sure it clearly improves boundaries or reduces duplication.
```
