# 开发中蒙层（Dev Overlay）

## 目标

在正式发布包中，为 Agent 和定时任务模块添加磨砂玻璃蒙层，提示用户功能正在开发中。开发模式下不显示，不影响开发调试。

## 设计决策

- **通用组件方案**：创建 `<DevOverlay>` 组件，在 App.tsx 中包裹目标模块，模块代码零侵入
- **环境检测**：通过 preload bridge 暴露 `app.isPackaged`，渲染进程读取判断是否为正式包
- **交互行为**：蒙层拦截所有点击，用户可见底层界面但无法操作
- **覆盖范围**：整个模块 tab 区域（包括侧边栏和内容区）
- **蒙层内容**：极简风格，图标 + "开发中" 文字居中

## 组件：`desktop/src/components/dev-overlay.tsx`

### Props

```typescript
interface DevOverlayProps {
  children: React.ReactNode
  label?: string // 默认 "开发中"
}
```

### 渲染逻辑

1. 外层 `relative` 容器渲染 children
2. 读取 `isPackaged` 状态
3. 当 `isPackaged === true` 时，叠加绝对定位蒙层
4. 当 `isPackaged === false` 时，仅渲染 children，无蒙层

### 蒙层样式

- 定位：`absolute inset-0 z-50`
- 背景：`bg-background/60 backdrop-blur-md`（磨砂玻璃效果）
- 内容：flex 居中，图标（Construction）+ 文字
- 文字样式：`text-muted-foreground text-sm`

## 环境检测：Preload Bridge

### 主进程

在 preload.ts 中通过 `contextBridge` 暴露：

```typescript
app: {
  isPackaged: app.isPackaged
}
```

### 渲染进程

通过 `requireSynapseBridge().app.isPackaged` 读取。

## 使用方式

在 `App.tsx` 中包裹目标模块：

```tsx
{activeTab === "agent" ? <DevOverlay><AgentModule /></DevOverlay> : null}
{activeTab === "task-scheduler" ? <DevOverlay><TaskSchedulerModule /></DevOverlay> : null}
```

## 影响范围

- 新增文件：`desktop/src/components/dev-overlay.tsx`
- 修改文件：`desktop/electron/preload.ts`（新增 app.isPackaged 暴露）
- 修改文件：`desktop/src/App.tsx`（包裹两个模块）
- 类型文件：preload bridge 类型定义（如有）

## 未来扩展

新模块需要蒙层时，只需在 App.tsx 中用 `<DevOverlay>` 包裹即可。当功能开发完成，移除包裹层恢复正常访问。
