# System Notifier V1 Design

## Goal

System Notifier is a desktop-only system app and capability that triggers the current computer's native system notification. It provides one stable MCP tool and one Workflow node while keeping platform differences, notification permission state, and Electron delivery failures behind a fire-and-forget boundary.

It is a generic, one-way, non-interactive notifier. It is not a notification center, reliable delivery queue, history store, or callback framework. Existing interactive notifications such as Update Service navigation remain owned by their business modules.

## Stable identities

- App ID: `system-notifier`
- App namespace: `system_notifier`
- Service ID: `core.system-notifier`
- DataRepository namespace: `app.system-notifier.settings`
- Capability: `app.system_notifier.notification.trigger@1.0.0`
- MCP tool: `app_system_notifier_notification_trigger`
- Workflow node: `system_notifier_notification_trigger`

The App, capability, MCP tool, and Workflow node are registered on every supported desktop platform. Availability means Synapse implements the stable trigger contract; it does not promise that the operating system can display a notification.

## Public input and result

The public trigger accepts exactly:

```ts
{ title: string; body: string }
```

Both fields are required, non-empty, single-line strings equal to their own JavaScript `trim()` result. Title is limited to 64 Unicode code points and body to 256. CR, LF, Tab, NUL, other Unicode `Cc` characters, line and paragraph separators, and unpaired UTF-16 surrogates are rejected. Valid content is not normalized, trimmed, truncated, redacted, or otherwise modified.

Validation returns only the first stable error:

```ts
{
  ok: false,
  code: "INVALID_INPUT",
  error: "Invalid system notification input.",
  data: {
    field: "request" | "title" | "body",
    reason:
      | "required"
      | "type"
      | "leading_or_trailing_whitespace"
      | "forbidden_character"
      | "invalid_unicode"
      | "too_long"
      | "unknown_field"
  }
}
```

After valid input crosses the core service acceptance point, MCP and Workflow return only `{ success: true }`. The result means the call was accepted under the fire-and-forget contract. It does not report sent, delivered, displayed, platform, permission, suppression, degradation, or adapter failure.

## Core processing

The core service is a main-process singleton registered independently of DataRepository, AuditSink, WindowManager, and Electron notification support. A second bootstrap integration uses the ServiceRegistry order-only `startAfter` edge to give DataRepository and AuditSink a chance to start before it attaches available storage, audit, and adapter ports. A degraded ordinary-port failure does not skip integration: it initializes the same service interface in a degraded, fail-closed state. See [ADR 0129](../../adr/0129-add-order-only-non-propagating-dependency-edges-to-service-registry.md).

For each valid call the service:

1. Attempts one content-free audit record.
2. Reads the current immutable settings snapshot synchronously.
3. For a normal call, returns fixed success without touching the limiter when settings are unavailable or notifications are disabled.
4. For a test call, skips only the enabled check and uses the current silent value or `false` when unavailable.
5. Atomically acquires one identity-bucket and one global-bucket token.
6. Invokes the adapter once when both tokens are available.
7. Returns fixed success immediately.

There is no persistent queue, retry, delayed delivery, crash recovery, replay, idempotency key, notification ID, content deduplication, or cancellation handle. Workflow cancellation is honored before interpolation and again after validation immediately before core acceptance. Cancellation after acceptance cannot revoke the attempt or fixed success.

## Native adapter

After Electron is ready, the adapter checks `Notification.isSupported()` once. Unsupported or failed initialization installs a no-op adapter. An allowed attempt performs only:

```ts
new Notification({ title, body, silent }).show()
```

The adapter installs no `show`, `failed`, `click`, `close`, `reply`, or `action` listeners. It catches only synchronous construction and `show()` exceptions, reports a redacted fixed diagnostic reason, and releases the notification reference after `show()` returns. It does not query or request operating-system notification permission and contains no platform-specific business branch.

## Settings

The only persisted record is the optional singleton:

```ts
{ schemaVersion: 1, enabled: boolean, silent: boolean }
```

No record uses in-memory defaults `{ enabled: true, silent: false }` without seeding storage. Startup corruption or the absence of any valid read marks the snapshot unavailable and normal triggers fail closed. A transient later read failure preserves the last valid snapshot but returns a load error to the App. `settings.get` and `settings.update` share one serial storage channel; triggers do not enter it. Update rereads the latest stored singleton, rejects corrupt or unreadable data instead of repairing it, writes a complete value, and replaces the snapshot only after persistence succeeds.

The App IPC surface is exactly:

- `app.system_notifier.settings.get`
- `app.system_notifier.settings.update`
- `app.system_notifier.notification.test`

There are no IPC events and no Renderer trigger accepting arbitrary notification content.

## Rate limiting, audit, and diagnostics

The synchronous process-local limiter has two continuous token buckets:

- Identity: capacity 5, refill 1 token per 10 seconds.
- Global: capacity 20, refill 1 token per 2 seconds.

Both buckets refresh at the same monotonic timestamp and are decremented only when both have a token. Identity buckets are removed lazily after ten minutes without calls. Limiter state is not persisted or exposed.

MCP identity uses trusted source, client, controller, and actor context in the fixed fallback order. Workflow identity is `workflowId + nodeId` and excludes `runId`. The system-app test uses a separate fixed UI identity. Identity keys never enter logs or audit metadata.

Every valid accepted call attempts one audit event with action `notification.trigger`, resource `app.system_notifier.notification.trigger`, outcome `allowed`, trusted actor, source, title/body code-point lengths, and the applicable trusted MCP or Workflow identifiers. Notification content, summaries, hashes, names, settings, limiter state, adapter state, and delivery facts are never recorded. Audit failure is not retried.

The `core.system-notifier` logger accepts only fixed stages and reasons plus aggregated counts. It never records raw errors, stacks, notification content, or identity keys. Health exposes only `healthy` or `degraded` with fixed reasons and is not surfaced through MCP, Workflow, or the App UI.

## System App

System Notifier uses the existing single-instance system-app window. It is launchable and user-pinnable but absent from the default Dock. It has no deep links and trigger calls never open or focus it.

The centered single card contains only:

- “启用通知” Switch
- “静音通知” Switch
- Outline “发送测试通知” button

Switches auto-save. Saving disables controls; failure rolls back and displays only “保存失败”; success is silent. Loading uses Skeleton and load failure uses Alert with retry. The test button keeps the same label, is disabled with `aria-busy` only while its IPC Promise is pending, and displays no success state. A definite IPC failure displays only “无法发起测试，请重试”. Testing remains available when enabled is false and uses fixed content `{ title: "System Notifier", body: "这是一条测试通知" }`.

## Workflow and rollout

The Workflow node persists `title`, `body`, and shared `VariableBinding[]`. It uses two PromptEditors and one VariableBindingEditor, supports existing `{{name}}` and `{{$name}}` syntax through a no-content-log interpolation path, and shares the public input validator after interpolation. Its primary output is `{"success":true}` and structured output is `{ success: true }`. Its share contract requires `app.system_notifier.notification.trigger >= 1.0.0` and declares no additional resources, models, projects, sensitive paths, or high-risk permissions.

Adding the node advances the Workflow document schema from `2.5.0` to `2.6.0` with an empty migration and current fixture. Workflow share package format remains `4.0.0`. V1 ships directly without a feature flag and does not add server, account, cloud-sync, or website APIs.
