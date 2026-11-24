# Pending Release Notes

## 新增功能

- 在「设置 → MCP Server」中新增对 T3 Code 内置 Antigravity 隔离配置的条件识别与一键注册支持；仅在检测到本机 T3 Code Antigravity 配置时展示，按需注册并仅同步 `synapse-mcp`，后续启动时自动维护已注册配置的最新服务地址。

## 功能优化

- 写入客户端 MCP 配置文件时保留用户已建立的软链接，并跳过空文件的无意义备份。

## 问题修复

- 修复 Antigravity 迁移至新版全局配置位置后 MCP 配置路径不同步的问题，优先读写新版配置并兼顾已有旧路径。

## 技术调整
