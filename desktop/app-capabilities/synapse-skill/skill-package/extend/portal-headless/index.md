# Portal Headless

## Reaching Synapse tools

Synapse publishes only two tools: `search` and `invoke`. Search for `extend_portal_headless_credential_get` in domain `extend`, then invoke its exact returned name and schema. Business calls use the returned HTTP base URL; they are not MCP tools.

Read [api-reference.md](api-reference.md) before issuing HTTP requests.

## Flow

1. Use the local Synapse MCP `search` with `domain: "extend"` and `query: "Portal Headless 凭证"`; invoke the exact returned credential tool with its schema. It currently takes no arguments.
2. If unavailable, have the user sign into Synapse and connect **Portal Headless Test** in Connectors. Do not read browser cookies, ask the user to paste a token, or invoke the private authorization callback.
3. The credential result contains a Portal token and a separate short-lived SY extension authorization. Run the bundled [scripts/client.mjs](scripts/client.mjs) with Node.js 22+ to call the returned fixed `apiBaseUrl` directly. Follow the stdin protocol in [api-reference.md](api-reference.md); do not generate curl loops or put credentials in command-line arguments. The desktop MCP does not proxy business calls. Do not send the credentials to other hosts, redirects, tools for sharing, or a URL query; never print them in logs or your final answer, or persist them to ordinary files. Only the credential result is an intended sensitive output.
4. Use the client to call `context`, then `catalog` (`recommend` or `search`), then `describe`. Use returned `extensionInputSchema` and SDK `ai.inputs/output/consume/steps/completion/failures` to form the capability arguments. Do not guess identifiers, method signatures or schemas. `sdkPath` is descriptive, not an arbitrary execution path.
5. Answer using the actual results and their scope. Continue pagination when completeness is necessary. A query about reservations must never turn into creating a reservation.

## Current scope

Test environment only. The extension publishes the pinned SDK's complete catalog, including read and write capabilities, without a Synapse allowlist or Portal page-permission catalog filter. Portal still applies its own business authorization when a capability runs; a listed capability can therefore fail with `PORTAL_FORBIDDEN` for the connected account or tenant.

- Discover and describe the exact capability before every call. Use `/invoke` for direct write calls; the bundled client currently sends all capability calls through the compatible `/read` route, which can also mutate data.
- Never execute a write capability merely to answer what is available. Require an explicit user request for the business mutation, follow required prepare/lookup steps, preserve `requestId` across retries, and report uncertain results without blind resubmission.
- The full catalog does not mean every capability has been accepted against every account or business state. Treat SDK `ai.boundaries`, prerequisites, steps, completion, failures and idempotency as part of the calling contract.

- “今天”: determine the date in the user's timezone. The context reports server time and `Asia/Shanghai`; use an explicit user timezone if given.
- Meeting occupancy: describe first, then pass optional `date`; no room filter parameter exists. Filter names in the actual result if needed.
- Intersect cross-day reservations with the requested calendar day. An interval ending today at 23:00 covers today's 00:00–23:00, not the entire day; do not erase the remaining hour or infer a guaranteed booking slot from it.
- “我今年的年度双赢协议”: use the personal list, page through `pageNo/pageSize`, filter the returned `year`. Do not pass a nonexistent `year` filter or substitute the supervised-users list. Report partial results if you have not exhausted pagination.
- The pinned SDK has no yearly agreement detail capability. Once the current catalog/describe confirms this, stop discovery and explain the limitation; do not enumerate every domain or guess alternate endpoints. Explain this if tasks, indicators or the agreement body are requested; neither the list nor yearly schedule configuration is the body.
- `base-dict-get` follows the SDK's described dictionary contract; do not guess a `dictType` that was not returned by discovery or required by another capability.

## Answering

Respond in the user's language. Lead with the requested business result; for occupancy prefer a compact room/time table. Omit SDK IDs, endpoint names, tool-by-tool execution logs and repeated claims about credential handling unless the user requests diagnostics. Keep necessary scope or uncertainty to one short sentence.

`context.capabilityAccess` reports `mode: "all"` plus read/write counts for the pinned SDK. The catalog is the full SDK catalog, not a statement that the current Portal identity can execute every entry. A missing result means the pinned SDK does not publish that capability; a later `PORTAL_FORBIDDEN` means Portal rejected the connected account or tenant. Do not switch identities or bypass Portal authorization.

## Credentials and errors

The SY extension token expires after five minutes. On `SY_EXTENSION_AUTH_REQUIRED`, follow the client’s one-refresh protocol in the API reference; reacquire through MCP once and retry with `authRetry: 1`, then stop on failure. On `PORTAL_CREDENTIAL_INVALID`, reconnect Portal. A 403 (`PORTAL_FORBIDDEN`) is distinct from an expired login. Timeouts and upstream failures do not justify deleting credentials or changing identities.

Disconnecting Synapse stops future credential retrieval; it does not revoke Portal tokens already given to your AI. A previously issued SY extension token can remain usable until expiry, subject to the SY account remaining active and Portal credentials remaining valid. The desktop only needs to be online for credential retrieval.

If you have no HTTP execution tool, state that limitation. Do not substitute invented MCP business tools.
