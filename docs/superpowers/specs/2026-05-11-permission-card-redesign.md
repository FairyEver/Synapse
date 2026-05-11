# Agent 权限卡片重设计

**日期**: 2026-05-11  
**文件**: `desktop/src/modules/agent/components/agent-permission-card.tsx`

---

## 目标

将现有权限卡片从「左边框 + 内联徽章」样式升级为三段式结构，增强安全决策的视觉重量，同时保持与 shadcn radix-nova 设计系统一致。

---

## 结构

卡片分为三个垂直区域：

```
┌─────────────────────────────────────────────────┐
│  标题区（bg-muted/30）                           │
│  [图标]  工具名                    [状态 badge]  │
├─────────────────────────────────────────────────┤
│  代码区（bg-muted）                              │
│  命令内容                          [折叠按钮 ∧]  │
├─────────────────────────────────────────────────┤
│  操作区（仅 pending 时显示）                     │
│  [✕ 拒绝]                [✓ 允许]               │
└─────────────────────────────────────────────────┘
```

---

## 三种状态

### Pending（待处理）

- 标题区：`ShieldAlert` 图标，`text-muted-foreground`，无 badge
- 操作区：可见；拒绝用 `variant="outline"`，允许用 `variant="default"`
- 代码区：默认展开，右上角提供折叠按钮
- 若是当前最新的 pending 卡（`isLatestPending`），外层加 `ring-2 ring-primary`

### 已允许

- 标题区：`ShieldCheck` 图标，`text-green-500`；badge「✓ 已允许」绿色
- 操作区：不渲染
- 代码区：保持展开状态，可手动折叠

### 已拒绝

- 标题区：`ShieldX` 图标，`text-destructive`；badge「✕ 已拒绝」红色
- 操作区：不渲染
- 代码区：保持展开状态，可手动折叠

---

## 多 Pending 卡叠放

所有 pending 卡都完整展开。最新一张（时间线中最后出现的）加 `ring-2 ring-primary` 高亮边框，表示「当前需要处理」。旧的 pending 卡保持普通边框。

`isLatestPending` 由父组件 `AgentTimelineItem` 计算后作为 prop 传入。

---

## Token 映射

| 部位 | Tailwind / shadcn token |
|---|---|
| 卡片容器 | `bg-card border border-border rounded-lg overflow-hidden` |
| 标题区背景 | `bg-muted/30` |
| 分隔线 | `border-t border-border` |
| 代码区背景 | `bg-muted` |
| 代码文字 | `font-mono text-xs text-foreground` |
| pending 高亮 | `ring-2 ring-primary` |
| 允许图标色 | `text-green-500` |
| 拒绝图标色 | `text-destructive` |
| 允许 badge | `variant="secondary"` + 绿色图标 |
| 拒绝 badge | `variant="destructive"` |

---

## Props 变更

```ts
type AgentPermissionCardProps = {
  readonly item: SynapseAgentPermissionRequestTimelineItem
  readonly pending: boolean
  readonly isLatestPending: boolean   // 新增：是否为最新 pending 卡
  readonly onRespond: (requestId: string, behavior: "allow" | "deny") => void
}
```

`isLatestPending` 在 `AgentTimelineItem` 中计算：遍历 `pendingPermissions`，判断当前 item 的 `requestId` 是否为最后一个。

---

## 不变的内容

- 组件文件路径不变：`agent-permission-card.tsx`
- `onRespond` 回调签名不变
- `AgentPermissionPanel`（底部浮动面板）不在本次改动范围内
- 不新增依赖
