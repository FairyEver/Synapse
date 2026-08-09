# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复

- 修复 Workflow MCP 节点发现描述漏掉 JSON 修复、系统通知、剪贴板与 JavaScript/Node.js 节点的问题，Agent 现在能从工具描述与创建参数中发现当前已支持的节点。
- Git 工作台与 Agent Git 操作的持久化日志不再记录完整本地仓库路径，避免诊断日志暴露用户名、公司或私有目录结构。
- 修复 Workflow 中 JSON 修复节点的结构化 `json` 输出无法绑定到 JavaScript/Node.js 节点的问题。

## 技术调整
