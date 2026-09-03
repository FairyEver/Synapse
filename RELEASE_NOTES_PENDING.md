# Pending Release Notes

## 新增功能

## 功能优化

- 单文件 HTML 分享预览现在支持网页使用 `localStorage` 和 `sessionStorage`；由于分享内容与 Synapse 同源，请仅分享可信 HTML。

## 问题修复

- 修复 Figma 连接器将“本地端口可访问”误判为“Figma MCP 已可用”的问题；现在会完成 MCP 初始化和工具发现，连接失败或超时时显示可操作的原因，并避免向对话注入不可用的 Figma 能力。

## 技术调整
