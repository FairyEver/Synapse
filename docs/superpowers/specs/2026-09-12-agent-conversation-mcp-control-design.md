# Agent Conversation MCP Read and Collaborative Control

## Goal

Allow a Codex task with the built-in Synapse Skill to discover groups and create local conversations, or use an existing Agent deep link as a same-device conversation address, then inspect, observe, message, steer, stop, force-stop, or answer one exact pending request through canonical Synapse MCP tools.

The only Agent conversation deep link is `synapse://threads/<thread-id>`, aligned with the single-path thread locator shape used by Codex. The path id is the body of a short checksummed `conversationRef`; Synapse resolves it across local persisted projects and percent-encodes any Markdown-sensitive path character. The former `synapse://app/agent/open?projectId=...&conversationId=...` route is not registered or parsed. The link carries no content, secret, lease, or authorization. Thread path parsing normalizes only Markdown escapes before `.`, `_`, and `-` after one percent-decoding pass, then requires the full identifier shape and valid checksum. Other backslashes, extra path segments, queries and fragments remain invalid. Generated paths percent-encode all three punctuation characters to avoid Markdown copy transformations.

## Group Discovery and Creation

- `app.agent.provider.list` reuses ProviderService and the custom conversation dialog's model-tier selection rules. It returns non-archived providers as providerId/name plus selectable models (modelTier/modelName/displayName), with providerId filtering, case-insensitive provider/model name search, offset pagination and at most 100 providers per page. Each matching provider retains all its selectable tiers. Local Claude Code default remains selectable without a concrete model name (modelName null). No env, secrets, connection settings or paths are returned. It uses agent.conversation.read and the existing rate limit/audit boundary; queries and returned names are not audited.
- AI must discover requested models and use the returned providerId/modelTier pair. Ambiguous provider/model names require clarification; unavailable choices must not silently use defaults. Discovery reflects configured model slots, not a remote vendor's full model catalog. Model selection is included in creation's idempotency fingerprint.

- Groups are the built-in 本地对话 project plus configured projects, including knowledge base projects. Source filters and the archived section are not groups for creation. Discovery supports case-insensitive name substring search, offset pagination and at most 100 groups per page; it returns only projectId, name, isDefault and nextOffset.
- Creation accepts at most one of projectId, exact projectName, or sameGroupAs (an existing-conversation target). No selector always means 本地对话, independent of the caller working directory or current UI selection. Missing or ambiguous groups fail without fallback; a deleted project cannot receive a new conversation even when its history remains readable.
- sameGroupAs only resolves the source project. The new conversation has no copied history, persona, model, session key, source, or permission grants. It is created through AgentRuntimeService using local:renderer / local-renderer, the ordinary agent, current configured default permission mode and the same pure default-model selection helper as UI quick create. Creation optionally accepts providerId and modelTier together, matching the custom conversation dialog. An explicit selection must exist, be non-archived and selectable; otherwise model_unavailable is returned without fallback or persistence. Omitting both retains quick-create defaults. No path, persona, source, or permission overrides are accepted by this MCP operation. Knowledge base migration/workspace checks remain authoritative.
- Successful creation returns created, projectId, providerId, modelTier, conversationRef and the canonical deepLink. It refreshes the sidebar through the existing conversationUpdated EventBus event without opening or focusing a window. Notification failure after persistence is logged and does not turn creation into a retryable failure.
- Creation is separate from send: create first, send with the returned reference, then observe/inspect. A send failure must not cause a second creation. A UUID key deduplicates unchanged concurrent/retried create requests by client and operation before group resolution, so changing defaults or deleting the source after success does not redirect a retry. The existing bounded process-local cache expires after 10 minutes; restart or eviction ends the guarantee.
- Discovery uses agent.conversation.read; creation uses agent.conversation.control. Both use the existing rate limits and audit boundary. Audit does not include query, group name, conversation name, links, paths or content; successful creation records projectId and conversationRef.

## Public Surface

The existing Agent capability package owns eleven capabilities and same-named canonical MCP tools:

- `app.agent.conversation.open`
- `app.agent.conversation.inspect`
- `app.agent.conversation.observe`
- `app.agent.message.send`
- `app.agent.turn.steer`
- `app.agent.turn.stop`
- `app.agent.turn.force_stop`
- `app.agent.permission.respond`
- `app.agent.provider.list`
- `app.agent.group.list`
- `app.agent.conversation.create`

Only `open` is a Deep Link action. The package adds no System App, Dock item, Workflow node, or Automation action.

## Hard Rules

- Every public input is a strict object. Existing-conversation operations accept exactly one target form: a complete unchanged `deepLink`, `projectId + conversationRef`, or legacy `projectId + conversationId`. The main process parses canonical thread links without a project id, scans bounded conversation summaries across persisted projects, and resolves exactly one match; mixed forms, malformed links, damaged checksums, and ambiguous matches are rejected before access.
- Every conversation source may be inspected. Only `local`, `local-renderer`, and legacy missing-platform user conversations may be controlled.
- Control uses the project container's `AgentRuntimeService`; database mutation is never a control path.
- Send admits a turn asynchronously and returns its `turnId`, queue disposition, queue position, and revision without waiting for completion. Existing Renderer send remains synchronous and compatible.
- Steer, graceful stop, force stop, and pending-request response target the exact current `turnId`. A changed turn fails without affecting the new turn.
- Graceful stop only asks the live session to interrupt. Failure to issue that request is an operation failure; no timeout or fallback automatically invokes force stop.
- Force stop is a separate high-risk action and requires explicit current user intent.
- Permission response must also match a still-pending `requestId` and its kind. Tool permission requires the exact tool name. Question answers must cover every question exactly once and satisfy option/cardinality constraints.
- Generic takeover, continuation, or monitoring intent is not authorization to allow a tool permission. Underlying Shell, filesystem, network, and other tool permission checks remain authoritative.

## Inspection and Redaction

Inspection presents the same persisted timeline model used by the Agent UI, including visible messages, thinking, tool calls/results, permission requests, results, errors, file checkpoints, and safe SDK event summaries.

- Default page size is 50 and maximum page size is 100.
- Pagination preserves user-turn boundaries.
- One returned timeline item is at most 64 KiB and one page is at most 1 MiB.
- Redaction recursively covers secret-like keys and text.
- Provider/SDK session identifiers, raw SDK payloads, Base64 content, and internal artifact URLs are omitted.
- Pending requests expose only the identifiers and sanitized fields needed to make a precise response.
- Inspection returns the short stable `conversationRef`; pagination, observation, and control should reuse it so Agents never need to reconstruct the internal conversation id.

## Revision and Observation

The control service maintains a process-local increasing revision for each `{ projectId, conversationId }`. Agent events, persisted conversation changes, and admitted control mutations advance it. Only the latest bounded change history is retained.

`observe` is a long-poll, not a transcript stream. It returns whether the revision changed, the new revision, change types, history count, and a runtime snapshot. It never repeats message or tool bodies.

- Maximum wait is 30 seconds.
- A watermark above the current revision fails with `watermark_ahead` and returns the current revision.
- Concurrent waits are limited to 4 per conversation, 8 per client, and 32 globally.
- Cancellation and timeout release waiter capacity.

Runtime lifecycle is normalized to `idle | queued | starting | running | awaiting_permission | stopping`, with an active `turnId`, bounded queued turns, and pending request identity.

## Idempotency, Permission, and Audit

Create, send, stop, force stop, and permission response use UUID idempotency keys. Results are cached by MCP client, action, and key in a bounded process-local cache. Reusing a key with different input fails with `idempotency_conflict`; restart does not preserve the cache.

Read operations are limited to 60 calls per client per minute and writes to 30. New `PermissionGuard` actions are:

- `agent.conversation.read`
- `agent.conversation.control`
- `agent.conversation.stop`
- `agent.conversation.forceStop`
- `agent.permission.respond`

Audit records contain only action, actor, project/conversation/turn/request identifiers, result, tool name when required, and content or answer length/count. They never contain messages, thinking, tool input/output, or answers.

## Skill Routing

- Open intent calls `open`.
- Review or summary intent pages through `inspect`.
- Current-task monitoring inspects once and then long-polls `observe`.
- Ordinary follow-up uses asynchronous `send`; only an explicit adjustment to the active task uses `steer`.
- Stop first reads the active turn and calls graceful `stop`; it never automatically calls force stop.
- Tool permission allow requires explicit approval of that exact operation in the current Codex request.
- Background monitoring is created only when explicitly requested. Its heartbeat is read-only, quiet while unchanged, and reports completion, failure, or required attention without sending, approving, answering, or stopping.

## Stable Errors

Creation additionally uses `group_not_found`, `group_ambiguous`, and `model_unavailable`. Control surfaces use `invalid_input`, `not_found`, `project_unavailable`, `control_not_supported`, `no_active_turn`, `turn_changed`, `permission_not_pending`, `permission_kind_mismatch`, `idempotency_conflict`, `watermark_ahead`, `quota_exceeded`, and `operation_failed`. Navigation keeps its existing `open_failed` error.
