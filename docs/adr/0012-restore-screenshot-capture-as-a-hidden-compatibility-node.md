---
status: superseded by ADR-0015
---

# 恢复 screenshot_capture 为隐藏的工作流兼容节点

为保证已有 `screenshot_capture` 工作流仍可加载、查看、验证和运行，恢复最小化的 deprecated 兼容节点、配置 schema、renderer 展示和执行服务，并重新加入其执行所需的原生依赖 `node-screenshots@0.2.8`。不恢复已删除的截图系统应用、MCP 或无关 UI，且新建节点面板不展示该节点；原生模块必须按 Electron 打包边界校验。在存在语义等价的替代能力和显式 schema 迁移之前，不得再次删除该兼容节点。
