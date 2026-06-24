# 设置

<!-- Sources: desktop/src/modules/settings/data.ts; desktop/src/types/config.ts; desktop/src/modules/settings/components/project-list-editor.tsx; desktop/src/modules/settings/components/provider-panel.tsx; desktop/src/modules/settings/components/diagnostics-panel.tsx -->

## 仓库

仓库设置用于管理 Synapse 内容仓库。每个仓库记录名称、本地路径和内容目录映射。

添加仓库后，Synapse 读取其中的 Rule、Skill 和 Prompt，并在资源仓库中展示。

## 项目和知识库

项目设置用于保存 Agent、Workflow、Automation 和项目级安装可用的目标。普通项目记录名称和本地路径。

Knowledge Base 项目由 Synapse 创建和管理，显示为 `synapse-kb://<id>`，资料管理入口位于项目列表。

## 模型与供应商

模型与供应商设置保存 Agent 和 Workflow 使用的 provider、endpoint、模型名称、默认模型档位和环境变量。

Synapse 在运行 Agent 或 Workflow prompt 节点时读取当前 provider 配置。敏感字段不应写入网站示例。

## 提示词片段

提示词片段是 Agent composer 的全局输入片段。片段在设置中维护，在 Agent 输入框中插入，不自动发送。

## 私人令牌

私人令牌用于内容安装占位符替换和 MCP variable 能力。变量值属于敏感数据，列表接口不返回明文。

## 本机 IDE

本机 IDE 设置用于维护编辑器目录、Claude Code 集成和 Agent runtime 状态。

## 诊断日志

诊断面板用于运行本机检查、复制诊断摘要和导出诊断包。排障时优先使用该入口生成当前环境信息。
