# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复

- 修复 Workflow MCP 节点发现描述漏掉 JSON 修复、系统通知、剪贴板与 JavaScript/Node.js 节点的问题，Agent 现在能从工具描述与创建参数中发现当前已支持的节点。
- Git 工作台与 Agent Git 操作的持久化日志不再记录完整本地仓库路径，避免诊断日志暴露用户名、公司或私有目录结构。
- 修复 Workflow 中 JSON 修复节点的结构化 `json` 输出无法绑定到 JavaScript/Node.js 节点的问题。
- 管理密钥页现在会区分密钥无效、请求来源错误、认证服务故障和网络失败，不再把所有问题都显示为“密钥无效”。
- 修复内置 Synapse Skill 错误否认 JavaScript/Node.js Automation Action 的问题，Agent 现在会将脚本自动化配置正确路由到 Automation 能力。
- Agent 工作区的复制、导出、打开引用与直发操作不再将会话路由标识写入日志或诊断埋点。
- 文本写入、HTML 文件生成与文本提取保存现在支持文件系统允许的长文件名，不再因内部临时文件名过长而失败。
- Drive 链接 materialize 的审计记录不再包含本地缓存绝对路径，工具返回的本地文件结果保持不变。

## 技术调整
