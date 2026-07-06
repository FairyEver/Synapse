# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复

- 修复知识库 `/wiki-ingest` 更新旧页面时不会自动补齐 DragonScale address 的问题，避免重新摄入后留下 `wiki-lint` 地址错误。
- 修复 Bridge、Relay、Webhook 等全局 Agent 入口打开托管知识库时误用虚拟路径的问题，外部入口现在会使用知识库真实运行目录并加载对应 runtime 能力。
- 修复知识库 `/wiki-ingest` 静默跳过超过扫描上限的原始资料问题，Agent 现在会收到跳过文件及原因并提示用户处理。
- 修复 Windows/CRLF Markdown frontmatter 在知识库中被误判为空的问题，避免补地址时写出双 YAML 头，并让 DragonScale 与 lint 能识别 CRLF 元数据。

## 技术调整
