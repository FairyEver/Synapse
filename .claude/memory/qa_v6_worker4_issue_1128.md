---
name: qa_v6_worker4_round6_issue_1128
description: 工作流 Prompt 节点无法使用托管 KB 的 SDK 插件和原生命令（#1128）
metadata:
  type: project
---

# Issue #1128: 工作流 Prompt 节点无法使用托管知识库

创建于 2026-05-26，P1 级别，workflow-usability 方向。

## 根因

`desktop/electron/services/agent-runtime/index.ts` 中 `isManagedKnowledgeBaseRendererMessage` 要求 `message.platform === "local-renderer"`，但工作流会话的 platform 为 `"workflow"`，导致 12 个原生 KB 命令静默不可用。

## 证据链

- **Service 定义层**：`agent-runtime/index.ts:160-192` — `isManagedKnowledgeBaseRendererMessage` 门控
- **Agent Runtime 层**：`agent-runtime-service.ts:265` — `platform: sourcePlatform`
- **Bootstrap 层**：`descriptors.ts:1297` — `sourcePlatform: "workflow"`
- **测试确认**：`agent-runtime-service.test.ts:845` — `platform: "workflow"`

## 影响

工作流 Agent 在托管 KB 项目中无法使用 wiki/query/ingest 等命令，且无任何错误提示。

## 关联记忆

无其他记忆关联。NOT.md 不涵盖此场景。
