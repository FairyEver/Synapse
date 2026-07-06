# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复

- 修复知识库 `/wiki-ingest` 更新旧页面时不会自动补齐 DragonScale address 的问题，避免重新摄入后留下 `wiki-lint` 地址错误。
- 修复 Bridge、Relay、Webhook 等全局 Agent 入口打开托管知识库时误用虚拟路径的问题，外部入口现在会使用知识库真实运行目录并加载对应 runtime 能力。
- 修复知识库 `/wiki-ingest` 静默跳过超过扫描上限的原始资料问题，Agent 现在会收到跳过文件及原因并提示用户处理。
- 修复 Windows/CRLF Markdown frontmatter 在知识库中被误判为空的问题，避免补地址时写出双 YAML 头，并让 DragonScale 与 lint 能识别 CRLF 元数据。
- 统一知识库内部路径归一化逻辑，避免不同入口对 `/` 和 `\\` 混用路径产生不一致的 manifest、lint 或资料管理结果。
- 修复知识库资料导出目标路径存在符号链接且子目录尚未创建时的校验绕过，避免导出内容意外写回 `.raw` 目录。
- 修复知识库资料删除后清单同步失败时错误不明确的问题，现在会记录一致性风险并提示用户检查 `.raw/.manifest.json`。
- 修复知识库资料导出时多个条目之间预算不共享的问题，避免单次导出绕过文件数或总大小限制。
- 统一 Agent 运行时错误消息脱敏逻辑，避免日志或命令错误结果遗漏 Bearer、API Key、平台令牌等敏感信息。

## 技术调整
