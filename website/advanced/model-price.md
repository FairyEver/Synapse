# Model Price

<!-- Sources: desktop/src/modules/model-price/index.tsx; desktop/electron/services/model-price; desktop/synapse-capabilities/shared/model-price-domain.ts -->

## 功能范围

Model Price 管理模型价格规则和内置价格预设。价格用于 Agent、Workflow 和 Usage Analysis 的 token 费用估算。

规则使用模型匹配模式，价格单位为每 1M tokens。字段覆盖 input、output、cache read、cache write 和 reasoning 等 token 类型。

## 预设与覆盖

内置预设可导入或刷新。刷新预设时，Synapse 保留不匹配预设模式的用户规则。

覆盖状态用于确认已用模型是否存在命中规则。未命中的模型会显示为未定价，费用估算不应假设价格。

## MCP 能力

Model Price MCP 提供覆盖状态、预设列表、预设导入、规则读取、创建、更新、删除、清空、启用和停用。

修改、启停或删除规则时，使用规则的 opaque `ruleId`。`ruleId` 不是模型名，也不是 `modelPattern`。
