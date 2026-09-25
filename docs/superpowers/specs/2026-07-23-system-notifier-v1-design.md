# System Notifier V1 Design

## Goal

System Notifier is a desktop system app and capability that notifies the user. It provides one stable MCP tool and one Workflow node while keeping platform differences, notification permission state, and Electron delivery failures behind a fire-and-forget boundary.

One accepted trigger has two independent destinations:

- the native system notification of the computer running Synapse, and
- the account message center, which the server also pushes to the account's registered phones when the desktop is signed in and online.

The account destination travels on the desktop's existing authenticated login, so it needs no user API key and never goes through the open API. This is what lets an Agent or a Workflow reach a user who is away from the computer.

It is a generic, one-way, non-interactive notifier. The account-level message center owns cloud history for accepted formal triggers when the user is signed in and online. The trigger remains fire-and-forget and is not a reliable delivery queue or callback framework. Existing interactive notifications such as Update Service navigation remain owned by their business modules.

> **2026-09-25 修订：触发改为「通知用户」。** 此前这一能力只描述为「当前电脑的原生通知」，账号消息中心同步是文档尾部追加的一次尽力而为；现在两条出口都是正式语义，且不再互相门控。随之而来的三处变化见「Settings」「Core processing」和「System App」：设置升到 v2 并新增 `syncToAccount`，本机通知不再决定账号那一路是否发送，卡片多一颗开关。稳定身份、公开输入 `{ title, body }`、fire-and-forget 成功语义、限流与审计边界全部不变。

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
3. For a normal call, resolves two independent switches from that snapshot: `enabled` for the native destination and `syncToAccount` for the account destination. An unavailable snapshot fails closed, and a call with both destinations off returns fixed success without touching the limiter.
4. For a test call, shows locally regardless of `enabled`, uses the current silent value or `false` when unavailable, and never syncs.
5. Atomically acquires one identity-bucket and one global-bucket token.
6. Invokes the adapter once when both tokens are available and the native destination is on.
7. Starts a best-effort account message-center sync when the account destination is on; the sync itself decides whether it can run, since it needs a signed-in, online desktop and a currently running service.
8. Returns fixed success immediately.

The core service has no persistent queue, retry, delayed delivery, crash recovery, replay, idempotency key, content deduplication, or cancellation handle. The separate message center assigns an ID and retains successful online syncs for 90 days. Offline or unauthenticated calls only show locally and are never backfilled. Workflow cancellation is honored before interpolation and again after validation immediately before core acceptance. Cancellation after acceptance cannot revoke the attempt or fixed success.

## Native adapter

After Electron is ready, the adapter checks `Notification.isSupported()` once. Unsupported or failed initialization installs a no-op adapter. An allowed attempt performs only:

```ts
new Notification({ title, body, silent }).show()
```

The adapter installs no `show`, `failed`, `click`, `close`, `reply`, or `action` listeners. It catches only synchronous construction and `show()` exceptions, reports a redacted fixed diagnostic reason, and releases the notification reference after `show()` returns. It does not query or request operating-system notification permission and contains no platform-specific business branch.

## Settings

The only persisted record is the optional singleton:

```ts
{ schemaVersion: 2, enabled: boolean, silent: boolean, syncToAccount: boolean }
```

`enabled` and `silent` describe the native notification on this computer. `syncToAccount` describes the account message-center destination. They do not gate each other: turning local notifications off is how a user who is away from the computer keeps the machine quiet without losing phone delivery.

Storage reads revive the v1 singleton (`{ schemaVersion: 1, enabled, silent }`) as v2 with `syncToAccount` set to the old `enabled`. That is what the old record effectively did, so an upgrade neither starts notifying a user who had switched notifications off nor silently drops the account path for one who had them on. The namespace declares the v1 → v2 migration and a JSON envelope reviver, matching `app.terminal.agent-notification-settings`.

No record uses in-memory defaults `{ enabled: true, silent: false, syncToAccount: true }` without seeding storage. Startup corruption or the absence of any valid read marks the snapshot unavailable and normal triggers fail closed. A transient later read failure preserves the last valid snapshot but returns a load error to the App. `settings.get` and `settings.update` share one serial storage channel; triggers do not enter it. Update rereads the latest stored singleton, rejects corrupt or unreadable data instead of repairing it, writes a complete value, and replaces the snapshot only after persistence succeeds.

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

Every valid accepted call attempts one audit event with action `notification.trigger`, resource `app.system_notifier.notification.trigger`, outcome `allowed`, trusted actor, source, title/body code-point lengths, and the applicable trusted MCP or Workflow identifiers. Notification content is not recorded in audit or logs. When online sync succeeds, the complete title and body are stored in plaintext in the account's server-side message history and may appear in another device's lock-screen preview. Audit failure is not retried.

The `core.system-notifier` logger accepts only fixed stages and reasons plus aggregated counts. It never records raw errors, stacks, notification content, or identity keys. Health exposes only `healthy` or `degraded` with fixed reasons and is not surfaced through MCP, Workflow, or the App UI.

## System App

System Notifier uses the existing single-instance system-app window. It is launchable and user-pinnable but absent from the default Dock. It has no deep links and trigger calls never open or focus it.

The centered single card contains only:

- “本机通知” Switch (`enabled`)
- “静音通知” Switch (`silent`)
- “同步到手机” Switch (`syncToAccount`)
- Outline “发送测试通知” button

Switches auto-save. Saving disables controls; failure rolls back and displays only “保存失败”; success is silent. Loading uses Skeleton and load failure uses Alert with retry. The test button keeps the same label, is disabled with `aria-busy` only while its IPC Promise is pending, and displays no success state. A definite IPC failure displays only “无法发起测试，请重试”. Testing remains available when local notifications are off and uses fixed content `{ title: "System Notifier", body: "这是一条测试通知" }`; a test never reaches the account message center.

## Workflow and rollout

The Workflow node persists `title`, `body`, and shared `VariableBinding[]`. It uses two PromptEditors and one VariableBindingEditor, supports existing `{{name}}` and `{{$name}}` syntax through a no-content-log interpolation path, and shares the public input validator after interpolation. Its primary output is `{"success":true}` and structured output is `{ success: true }`. Its share contract requires `app.system_notifier.notification.trigger >= 1.0.0` and declares no additional resources, models, projects, sensitive paths, or high-risk permissions. The palette label is “发送通知”; the node type stays `system_notifier_notification_trigger`.

Adding the node advanced the Workflow document schema from `2.5.0` to `2.6.0` with an empty migration and current fixture. Workflow share package format remains `4.0.0`. Account sync was added later through the message center without changing the public MCP or Workflow success response; the 2026-09-25 revision promoted that sync to an independently switched destination and left both response contracts untouched.
