---
name: ui-log-audit
description: 静态审计 UI 交互日志覆盖率。扫描组件中的交互入口（onClick、onValueChange、onOpenChange、onSubmit、异步操作等），对照已有的 track()/logger 调用，找出未记录日志的遗漏点。Use when 日志审计、交互日志、日志覆盖、log audit、UI logging、遗漏日志、检查日志。
---

# UI Log Audit — UI 交互日志覆盖率审计

## 目标

扫描指定范围内的 React 组件，找出所有用户可触发的 UI 交互入口，检查每个入口是否有对应的日志记录，输出遗漏清单。

## 核心原则

1. **交互入口驱动**：从用户能触发的事件出发（不是从代码结构出发），逐个检查是否有日志。
2. **分层检查**：底层组件（ui/）的 `track()` 埋点 和 业务组件的 `logger.*()` 调用是两层，都要检查。
3. **纯静态分析**：不启动应用，通过代码阅读完成全部审计。

## 前置知识

审计前必须先了解项目的日志基础设施。读取以下文件建立上下文：

1. **`src/lib/ui-tracking.ts`** — `track()` 函数定义、`TrackAction` 类型、`extractLabel` 辅助
2. **`src/app-shell/logging.ts`** — `createRendererLogger()` 工厂，renderer 侧日志 API
3. **`src/app-shell/notifications.tsx`** — `showToast` 中的日志、`promise()` 中的异步耗时日志

记住这三个日志入口：
- `track({ component, name, action, value })` — 底层组件通用埋点
- `logger.info/warn/error(message, details)` — 业务语义日志
- `notificationLogger` — 通知弹出和异步操作耗时

## 交互入口分类

按优先级排序，每类都必须检查：

| 优先级 | 交互类型 | 代码特征 | 期望的日志 |
|--------|----------|----------|------------|
| P0 | 页面/Tab 切换 | `setActiveTab`、顶层 `onValueChange` | 记录 from → to |
| P0 | 异步操作 | `promise()`、`async` handler 中的 IO | 记录开始、耗时、成功/失败 |
| P1 | 对话框开关 | `onOpenChange`、`setIs*DialogOpen` | 记录 open/close + 对话框名称 |
| P1 | 表单提交 | `onSubmit`、`handleSubmit` | 记录提交动作 + 关键字段 |
| P1 | 分类/筛选切换 | `setActiveCategoryId`、`setFilter` | 记录 from → to |
| P2 | 搜索输入 | `setSearchQuery`、`onSearchChange` | 防抖后记录最终搜索词 |
| P2 | 排序变更 | `setSortOrder`、sort `onValueChange` | 记录新排序值 |
| P2 | 收藏/取消收藏 | `toggleFavorite` | 记录操作 + 目标 ID |
| P3 | 按钮点击 | `onClick` on `<Button>` | 底层 `track()` 自动覆盖（检查 `data-track` 是否有语义） |
| P3 | 下拉菜单选择 | `onSelect` in DropdownMenu | 底层 `track()` 自动覆盖 |

## 执行流程

### Phase 1：基础设施扫描（2 分钟）

1. 读取 `src/lib/ui-tracking.ts`，确认 `track()` 的签名和行为
2. 扫描 `src/components/ui/` 目录，列出哪些底层组件已接入 `track()`
3. 读取 `src/app-shell/notifications.tsx`，确认 `showToast` 和 `promise()` 的日志行为

输出一份底层覆盖清单：
```
✅ 已接入 track()：Button, Dialog, AlertDialog, Tabs, Select, ...
❌ 未接入 track()：[列出缺失的]
```

### Phase 2：业务组件扫描

用 Grep 搜索所有交互入口：

```
# 状态切换类
grep -rn "setState\|set[A-Z].*(" src/modules/ src/app-shell/ --include="*.tsx" --include="*.ts"

# 异步操作类
grep -rn "void promise\|async.*=>" src/modules/ --include="*.tsx"

# 直接 handler 类
grep -rn "onClick\|onSubmit\|onValueChange\|onOpenChange\|onSelect" src/modules/ --include="*.tsx"
```

对每个找到的交互入口，追踪调用链判断：
1. 是否经过已接入 `track()` 的底层组件？（如果是，底层已覆盖）
2. 是否有业务层 `logger.*()` 调用？
3. 如果两者都没有 → 标记为遗漏

### Phase 3：逐模块审计

按模块逐个检查，每个模块输出：

```
## [模块名] src/modules/xxx/

### 已覆盖
- ✅ [交互描述] — [覆盖方式：track()/logger/notification]

### 遗漏
- ❌ [P0] file:line — [交互描述] — 建议：[一句话修复方案]
- ❌ [P1] file:line — [交互描述] — 建议：[一句话修复方案]
```

### Phase 4：data-track 语义检查

扫描所有使用了底层 tracked 组件但没有传 `data-track` 的地方。没有 `data-track` 时，底层组件会用 fallback（如按钮文字、tab value），这些 fallback 在日志中可能不够清晰。

重点检查：
- `<Dialog>` 没有 `data-track` 且 `<DialogTitle>` 是动态内容
- `<Select>` 没有 `data-track`（fallback 是 value，可能是 ID 而非语义名）
- `<Tabs>` 没有 `data-track`（fallback 是 value）

### Phase 5：异步操作耗时检查

扫描所有 `void promise(` 调用，确认：
1. `loading` 参数是有意义的字符串（不是 `"加载中..."`）
2. 如果不经过 `promise()` 的异步操作（直接 `try/catch`），是否有手动计时日志

### Phase 6：输出报告

按严重程度排序：

```
## UI 日志覆盖率审计报告

### 底层组件覆盖率
- 已接入 track()：N/M 个组件
- 缺失：[列表]

### 业务层遗漏清单（按优先级）

#### P0 — 必须补上
- ❌ file:line — [描述] → **修复：** [方案]

#### P1 — 应该补上
- ❌ file:line — [描述] → **修复：** [方案]

#### P2 — 建议补上
- ❌ file:line — [描述] → **修复：** [方案]

### data-track 语义缺失
- ⚠️ file:line — `<Component>` 缺少 data-track，当前 fallback 为 [xxx]

### 异步操作耗时覆盖
- ✅ 经过 promise()：N 处
- ❌ 未经过 promise() 且无手动计时：[列表]

### 统计
- 总交互入口：N
- 已覆盖：N（底层 track: N + 业务 logger: N）
- 遗漏：N
- 覆盖率：XX%
```

## 范围控制

- 用户指定模块 → 只审计该模块
- 用户未指定 → 审计 `git diff --name-only` 中涉及的模块；如果没有 diff，审计全部 `src/modules/`
- 始终包含 `src/app-shell/` 中的交互入口

## 修复模式参考

| 遗漏类型 | 推荐修复 |
|----------|----------|
| 状态切换无日志 | 封装 setter：`const setX = useCallback((next) => { setXRaw(prev => { if (prev !== next) logger.info(...); return next }) }, [])` |
| 搜索无日志 | 用 `useDeferredValue` + `useEffect` 在 deferred 值变化时记录 |
| 异步操作无耗时 | 改用 `promise()` 包装，或手动 `performance.now()` 计时 |
| 底层组件缺 data-track | 加 `data-track="语义名称"` 属性 |
| 底层组件未接入 track() | 在组件中 import `track` 并在关键回调中调用 |

## 硬性规则

- **不自动修复**。输出遗漏清单，等用户决定修哪些。
- **不误报**。每个遗漏必须确认：(1) 该交互确实没有任何层级的日志 (2) 该交互对调试有价值。
- **不审计 ui/ 目录的内部实现**。底层组件只检查"是否接入了 track()"，不审计 track() 本身的实现。
- **不审计纯展示组件**。没有交互入口的组件跳过。
- **直接在对话中输出**，不生成文件。除非用户明确要求。
