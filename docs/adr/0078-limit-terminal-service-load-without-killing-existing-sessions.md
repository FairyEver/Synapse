# Limit Terminal service load without killing existing sessions

Terminal applies configurable service-level quotas to global and per-client running sessions, per-client and per-controller leases, per-session, client, and global observations, operation rates, semantic, raw, and paste request and byte rates, output, emulator memory, checkpoints, and persistence space. These are Synapse service protections, not OS process isolation.

A running session created through MCP remains charged to its creation `clientId` after transport disconnect and stops consuming running-session quota only at a terminal lifecycle state. Attribution supports quota and audit and creates no access ownership.

Before accepting work, the service returns structured `quota_exceeded` or `rate_limited` with a safe dimension, retryability, and `retryAfter` when applicable, without exposing another actor's identity or usage. Input, resize, creation, and similar throttled operations are rejected rather than placed in a hidden delayed queue. Work already accepted is not revoked because later usage exceeds a threshold.

There is no automatic stop or default idle timeout; long-running development services, builds, PM2 processes, and scripts may continue. When output persistence or memory reaches a hard boundary, the service continues draining the PTY, applies deterministic body eviction or discard, and advances gap, cumulative-loss, and degraded facts rather than silently blocking the child process.

Exact values are centralized configurable implementation parameters and machine-discoverable diagnostics, not permanent product promises. Constants placed in `desktop/config.ts` receive the repository-required Chinese purpose and impact comments. Capability metadata states `processResourceIsolation=none`: Terminal does not constrain shell CPU, memory, files, network, or process count. Quota and throttle audit is redacted and contains no bodies.
