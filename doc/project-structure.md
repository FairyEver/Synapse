# Synapse 项目结构说明

## 1. 当前目录骨架

仓库为 pnpm monorepo，所有源码集中在 `desktop/` 子包（`@synapse/desktop`）下：

```text
desktop/
  electron/
    main.ts
    preload.ts
    ipc/              # IPC 处理器
      channels.ts
      *-handlers.ts
    services/         # 主进程服务
      *.service.ts

  src/
    App.tsx
    main.tsx
    app-shell/
    components/
      ui/
    hooks/            # 共享 hooks
    lib/
    styles/
    types/
    modules/          # 业务模块
      content/
      logs/
      rules/
      settings/
      skills/
```

## 2. 各目录职责

### `desktop/electron/`

负责主进程与 preload。

- `main.ts`：窗口、生命周期、主进程入口
- `preload.ts`：桥接渲染层可用的受控 API
- `ipc/`：IPC 处理器，按业务域拆分（config-handlers.ts, content-handlers.ts 等）
- `services/`：主进程业务服务，如文件系统、Git、下载安装等

### `desktop/src/App.tsx`

负责应用壳层编排：

- 一级模块切换
- 顶层布局
- 壳层共享状态挂接

不要把深层业务逻辑继续堆进这里。

### `desktop/src/app-shell/`

负责应用壳层共享上下文与状态编排，例如：

- 当前激活模块
- 顶层刷新请求
- 壳层级行为协调

### `desktop/src/components/`

放共享 UI 组件。

要求：

- 尽量保持与业务无关
- 能通用于多个模块
- 不直接依赖某个具体模块实现

### `desktop/src/components/ui/`

放 shadcn/ui 组件源码。

要求：

- 优先复用
- 不随意分叉或深度魔改
- 若确需调整，优先通过组合而不是直接改内部实现
- 缺少的基础组件优先通过 shadcn CLI 新增到这里，而不是在 `desktop/src/components/` 里自定义平行 primitive

### `desktop/src/hooks/`

放跨模块共享的自定义 hooks。

适合：

- 响应式逻辑（如 use-mobile.ts）
- 跨模块复用的交互模式

### `desktop/src/lib/`

放纯工具函数与无业务归属的轻量辅助逻辑。

适合：

- 字符串处理
- 样式辅助
- 纯数据转换

不适合：

- 直接耦合某个模块的业务流程
- 文件系统与系统能力

### `desktop/src/types/`

放共享类型。

适合：

- 全局 API 类型
- 通用数据结构
- 跨模块共享的类型定义

### `desktop/src/modules/`

这是 Synapse 业务模块的标准根目录。

当前已有模块：

- `content/`：内容管理
- `logs/`：日志查看
- `rules/`：规则管理
- `settings/`：设置
- `skills/`：技能管理

重要约束：

- 新业务域优先作为 `desktop/src/modules/<module>/` 新增
- 不要同时引入 `desktop/src/features/` 作为平行目录
- 模块之间尽量通过共享类型、共享组件、或明确接口协作
- 不要直接相互依赖内部实现

## 3. 模块内建议结构

当某个模块复杂度上升时，优先在模块内部拆分，而不是把逻辑塞回共享层。

建议结构：

```text
desktop/src/modules/<module>/
  components/
  hooks/
  services/
  types.ts
  utils.ts
  index.tsx
```

说明：

- `components/`：该模块私有 UI 组件
- `hooks/`：该模块私有交互逻辑
- `services/`：该模块业务逻辑、数据适配、桥接封装
- `types.ts`：该模块私有类型
- `utils.ts`：该模块私有轻量工具

## 4. 导入边界

推荐遵守以下方向：

- `desktop/src/modules/*` 可以依赖 `desktop/src/components/`、`desktop/src/components/ui/`、`desktop/src/lib/`、`desktop/src/types/`、`desktop/src/hooks/`、`desktop/src/app-shell/`
- `desktop/src/components/` 不应依赖 `desktop/src/modules/*` 的具体实现
- `desktop/src/lib/` 不应依赖具体模块 UI
- `desktop/src/hooks/` 不应依赖具体模块业务逻辑
- renderer 代码不应 import `desktop/electron/*`
- preload 不应引用 renderer 组件代码

## 5. 新增代码时的默认放置策略

如果要新增代码，优先这样判断：

1. 是系统能力、文件、Git、下载、安装逻辑吗？
   放到 `desktop/electron/` 主进程代码中。
2. 是暴露给前端使用的受控能力吗？
   放到 `desktop/electron/preload.ts` 或其后续拆出的桥接文件中，并同步更新全局类型。
3. 是某个业务模块专属 UI 或逻辑吗？
   放到对应的 `desktop/src/modules/<module>/`。
4. 是多个模块都复用的纯展示组件吗？
   放到 `desktop/src/components/`。
   如果它本质上是按钮、输入框、弹窗、标签、滚动区等基础 primitive，优先检查 `desktop/src/components/ui/` 或先新增 shadcn 组件，而不是直接新建共享自定义组件。
5. 是多个模块都复用的交互逻辑吗？
   放到 `desktop/src/hooks/`。
6. 是纯工具函数或共享类型吗？
   分别放到 `desktop/src/lib/` 或 `desktop/src/types/`。

## 6. 明确禁止

- 在 `desktop/src/` 下新建与 `modules/` 平行、职责重复的 `features/`
- 把主进程逻辑直接塞进 React 组件
- 让共享组件依赖具体业务模块
- 因为图省事把所有新逻辑继续堆进 `desktop/src/App.tsx`
