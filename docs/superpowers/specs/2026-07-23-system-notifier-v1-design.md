# System Notifier V1 Design

## Goal

System Notifier is a desktop system app and capability that notifies the user. It provides one stable MCP tool and one Workflow node while keeping platform differences, notification permission state, and Electron delivery failures behind a fire-and-forget boundary.

One accepted trigger does exactly one thing: it writes the message into the account message center. The server then delivers that message to every online desktop of the account (including the one that sent it) and pushes it to the account's registered phones. Each desktop shows it as a native system notification when its own local-notification preference allows it.

The message travels on the desktop's existing authenticated login, so it needs no user API key and never goes through the open API. This is what lets an Agent or a Workflow reach a user who is away from the computer.

System Notifier also owns the native presentation side for this computer: the live connection hands every incoming account message to `presentAccountNotification`, which reads this capability's settings and calls the Electron adapter. That is the only place a native notification is constructed for account messages.

It is a generic, one-way, non-interactive notifier. The account-level message center owns cloud history for accepted formal triggers when the user is signed in and online. The trigger remains fire-and-forget and is not a reliable delivery queue or callback framework. Existing interactive notifications such as Update Service navigation remain owned by their business modules, and Terminal keeps ownership of its own clickable Claude Code notifications.

> **2026-09-25 修订（一）：触发改为「通知用户」。** 此前这一能力只描述为「当前电脑的原生通知」，账号消息中心同步是文档尾部追加的一次尽力而为；这条修订让账号那一路成为正式语义，并拆出一颗 `syncToAccount`。稳定身份、公开输入 `{ title, body }`、fire-and-forget 成功语义、限流与审计边界全部不变。该修订已被下面第二次修订取代，保留在此仅为记录当时的形态。

> **2026-09-25 修订（二）：只剩发送一条路。** 第一次修订之后，一次触发同时做两件事——自己弹本机原生通知，再发一条账号消息——而发送时带着本机 `deviceId`，正好把「收到广播后再弹」这条既有回显路径（`live-connection-service` 的 `notification.changed` 分支按 `deviceId === clientInstanceId` 去重）挡掉了。两条路径互相知道对方存在，才需要那套「本机已弹就不再弹」的约定。
>
> 现在触发只负责发送，本机弹窗由「收到那条消息」产生：发送不带 `deviceId`，发起的那台电脑和账号下其他电脑走同一条路；实时连接不再自己构造 `Notification`，改调 `presentAccountNotification`。`syncToAccount` 因而是**发送总闸**，`enabled` / `silent` 描述这台电脑收到消息时的呈现。**发不出去就是发不出去**：未登录或离线时账号里不会有这条消息，本机也不会另弹一条。第二次修订仍不改稳定身份、公开契约、成功语义、限流与审计边界。

> **2026-09-25 修订（三）：三处「名不副实」的修正。**
>
> 1. **没发出去不再无声无息。** 发送被关掉、设置读不出来、未登录、离线这四种情况以前只回固定成功、不留任何痕迹，用户问「AI 说通知我了但我没收到」时无从查起。现在每一次「已接受但没有发出」的调用都记一条 `notification_sync` 固定诊断，reason ∈ {`disabled`, `settings_unavailable`, `not_signed_in`, `offline`, `sync_failed`}。成功响应不因此改变：调用方仍然分不出「发了」和「没发」，能分出的是本地诊断。
> 2. **写入入口按授权范围改名。** 桌面写自己账号队列的入口是 `POST /api/notifications/desktop`：路径说的就是它只吃桌面登录态、只吃桌面自己拥有的 source。`/api/notifications/internal` 是它从前叫的名字，已发布的桌面构建仍在用，保留为行为完全一致的兼容入口。source 表由 `@synapse/shared` 的 `DESKTOP_NOTIFICATION_SOURCES` 单一来源派生，服务端校验与桌面请求入参不可能漂移。
> 3. **设置升 v3，字段名对上它门控的东西。** `enabled` / `syncToAccount` 改名 `localEnabled` / `sendEnabled`；迁移只搬值不改语义（v2 的 `enabled` → `localEnabled`、`syncToAccount` → `sendEnabled`；v1 那颗总开关同时喂给两个新字段）。界面标签不变。

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
2. Reads the current immutable settings snapshot synchronously. An unavailable snapshot fails closed and records one `notification_sync` / `settings_unavailable` diagnostic.
3. Returns fixed success without touching the limiter when `sendEnabled` is off, recording one `notification_sync` / `disabled` diagnostic: that switch is the send gate, so an accepted call that is switched off sends nothing.
4. Atomically acquires one identity-bucket and one global-bucket token.
5. Sends the message to the account message center. A signed-out or offline desktop sends nothing and each records its own `notification_sync` diagnostic (`not_signed_in` / `offline`); a failed request records `sync_failed`.
6. Returns fixed success immediately. The trigger path constructs no notification and shows nothing.

A send that cannot happen produces nothing at all: with no message in the account there is nothing for any device to receive, and the computer that asked shows nothing either. Running the caller already implies a running, signed-in desktop with a live connection, so this is a boundary the product accepts rather than a case to compensate for. Nothing is queued, backfilled, or retried.

The diagnostics are the answer to "the Agent said it notified me and nothing arrived". They are aggregated counts on fixed stages and reasons, carry no content or raw errors, and are never returned to the caller: the public result keeps its fixed success for every one of those cases.

A test call never enters this path. `presentTestNotification` validates the fixed content, audits it under the fixed system-app identity, acquires one limiter token, and shows locally regardless of `localEnabled`, using the current silent value or `false` when unavailable. It never sends.

Incoming account messages take a separate entry point. `presentAccountNotification({ title, body })` is called by the live connection for every account message that passes its own message-level filters, and shows it when `localEnabled` is on, with the current `silent` value. It does not consume limiter tokens: the send side already bounds the rate. This is the only place the trigger's own message can come back as a native notification on the computer that asked.

The core service has no persistent queue, retry, delayed delivery, crash recovery, replay, idempotency key, content deduplication, or cancellation handle. The separate message center assigns an ID and retains successful online sends for 90 days. Workflow cancellation is honored before interpolation and again after validation immediately before core acceptance. Cancellation after acceptance cannot revoke the attempt or fixed success.

## Native adapter

After Electron is ready, the adapter checks `Notification.isSupported()` once. Unsupported or failed initialization installs a no-op adapter. An allowed attempt performs only:

```ts
new Notification({ title, body, silent }).show()
```

The adapter installs no `show`, `failed`, `click`, `close`, `reply`, or `action` listeners. It catches only synchronous construction and `show()` exceptions, reports a redacted fixed diagnostic reason, and releases the notification reference after `show()` returns. It does not query or request operating-system notification permission and contains no platform-specific business branch.

The adapter is the only place a native notification is constructed for account messages. `live-connection-service` reaches it through an injected presenter port wired in `bootstrap/app-ready.ts`; when the port is missing, the live connection stays quiet rather than constructing one itself.

## Settings

The only persisted record is the optional singleton:

```ts
{ schemaVersion: 3, sendEnabled: boolean, localEnabled: boolean, silent: boolean }
```

`sendEnabled` is the send gate. `localEnabled` and `silent` describe how this computer presents incoming account messages: whether a native notification appears at all, and whether it makes a sound. The presentation switches do not gate sending, so a user who is away from the computer can keep the machine quiet without losing phone delivery.

Storage reads revive older singletons into v3 with the values carried across unchanged: v2's `enabled` → `localEnabled` and `syncToAccount` → `sendEnabled`; v1's single switch fed both, which is what that record effectively did, so an upgrade never starts sending for a user who had switched notifications off. The namespace declares the 1 → 2 and 2 → 3 migrations plus a JSON envelope reviver handling all three versions, matching `app.terminal.agent-notification-settings`.

No record uses in-memory defaults `{ sendEnabled: true, localEnabled: true, silent: false }` without seeding storage. Startup corruption or the absence of any valid read marks the snapshot unavailable and normal triggers fail closed. A transient later read failure preserves the last valid snapshot but returns a load error to the App. `settings.get` and `settings.update` share one serial storage channel; triggers do not enter it. Update rereads the latest stored singleton, rejects corrupt or unreadable data instead of repairing it, writes a complete value, and replaces the snapshot only after persistence succeeds.

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

Every valid accepted call attempts one audit event with action `notification.trigger`, resource `app.system_notifier.notification.trigger`, outcome `allowed`, trusted actor, source, title/body code-point lengths, and the applicable trusted MCP or Workflow identifiers. The system-app test attempts the same audit under its fixed UI actor. Notification content is not recorded in audit or logs. When the send succeeds, the complete title and body are stored in plaintext in the account's server-side message history and may appear in another device's lock-screen preview. Presenting an incoming account message writes no audit event of its own; that message's own creation was audited where it was created. Audit failure is not retried.

A send whose request threw records one `notification_sync` / `sync_failed` diagnostic. The signed-out or offline case sends nothing and records nothing: it is a normal no-op, not a failure.

The `core.system-notifier` logger accepts only fixed stages and reasons plus aggregated counts. It never records raw errors, stacks, notification content, or identity keys. Health exposes only `healthy` or `degraded` with fixed reasons and is not surfaced through MCP, Workflow, or the App UI.

## System App

System Notifier uses the existing single-instance system-app window. It is launchable and user-pinnable but absent from the default Dock. It has no deep links and trigger calls never open or focus it.

The centered single card contains only:

- “发送通知” Switch (`sendEnabled`)
- “本机通知” Switch (`localEnabled`)
- “静音通知” Switch (`silent`)
- Outline “发送测试通知” button

Switches auto-save. Saving disables controls; failure rolls back and displays only “保存失败”; success is silent. Loading uses Skeleton and load failure uses Alert with retry. The test button keeps the same label, is disabled with `aria-busy` only while its IPC Promise is pending, and displays no success state. A definite IPC failure displays only “无法发起测试，请重试”. Testing remains available when local notifications are off and uses fixed content `{ title: "System Notifier", body: "这是一条测试通知" }`; a test never reaches the account message center.

## Workflow and rollout

The Workflow node persists `title`, `body`, and shared `VariableBinding[]`. It uses two PromptEditors and one VariableBindingEditor, supports existing `{{name}}` and `{{$name}}` syntax through a no-content-log interpolation path, and shares the public input validator after interpolation. Its primary output is `{"success":true}` and structured output is `{ success: true }`. Its share contract requires `app.system_notifier.notification.trigger >= 1.0.0` and declares no additional resources, models, projects, sensitive paths, or high-risk permissions. The palette label is “发送通知”; the node type stays `system_notifier_notification_trigger`.

Adding the node advanced the Workflow document schema from `2.5.0` to `2.6.0` with an empty migration and current fixture. Workflow share package format remains `4.0.0`. Account delivery was added later through the message center without changing the public MCP or Workflow success response; the 2026-09-25 revisions made that delivery the only path and left both response contracts untouched.
