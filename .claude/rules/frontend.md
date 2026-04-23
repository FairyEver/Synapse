---
name: frontend
paths:
  - desktop/src/**/*.ts
  - desktop/src/**/*.tsx
---

# 前端架构约定

## 状态管理

- 全局状态用 React Context（Config / Repository / Identity / Notifications）
- 模块内状态用组件 local state
- 持久化数据通过 IPC 读写主进程，不在渲染进程做本地持久化

## IPC 通信

- 渲染进程统一通过 `window.synapse.<domain>.<method>()` 调用
- 不直接使用 `ipcRenderer`，所有通道在 preload 中封装
- channel 命名：`synapse:<domain>:<action>`

## 模块组织

- 每个功能模块在 `src/modules/<name>/` 下自包含（组件、hooks、types、utils）
- 跨模块共享的放 `src/components/`、`src/hooks/`、`src/lib/`
- 模块间不直接 import，通过 Context 或 IPC 解耦

## 路由与导航

- App Shell 管理 tab 状态（rules / skills / prompts / data-store / settings）
- 内容详情通过 Dialog 展示，不走路由跳转

## hooks 规范

- 封装 IPC 调用为 custom hook，组件不直接调 `window.synapse.*`
- hook 命名 `use<Domain><Action>`（如 `useContentList`、`useRepositorySync`）
- 副作用清理必须在 useEffect return 中处理
