import {
  STATE_SYNC_DOC_MAX_BYTES,
  STATE_SYNC_MAX_DOCS_CAP,
  STATE_SYNC_MAX_DOCS_DEFAULT,
  STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS,
  STATE_SYNC_MAX_PATH_DEPTH,
  STATE_SYNC_MAX_SUBSCRIBED_PATHS,
  STATE_SYNC_MAX_VALUE_DEPTH,
  STATE_SYNC_META_MAX_BYTES,
  STATE_SYNC_WRITE_MAX_BYTES,
  STATE_SYNC_WS_FRAME_MAX_BYTES,
} from "@synapse/shared/state-sync-contracts"

export type StateSyncLimitsConfig = {
  readonly maxDocBytes: number
  readonly maxWriteBytes: number
  readonly maxWsFrameBytes: number
  readonly maxHttpBodyBytes: number
  readonly maxMetaBytes: number
  readonly maxPathDepth: number
  readonly maxValueDepth: number
  readonly maxSubscribedPaths: number
  readonly maxOnDisconnectActions: number
  readonly defaultMaxDocsPerSpace: number
  readonly maxDocsPerSpaceCap: number
  readonly maxTokensPerSpace: number
  readonly maxConnectionsPerDoc: number
  readonly maxObserversPerDoc: number
  readonly maxConnectionsPerSpace: number
  readonly maxConnectionsPerAccount: number
  readonly maxGlobalConnections: number
  readonly wsRatePerSec: number
  readonly wsBurst: number
  readonly docWriteRatePerSec: number
  readonly docWriteBurst: number
  readonly docCreateRatePerMin: number
  readonly docCreateBurst: number
  readonly authTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly maxMissedHeartbeats: number
  readonly slowConsumerBytes: number
  readonly replayMaxItems: number
  readonly replayWindowMs: number
  readonly flushDebounceMs: number
  readonly flushMaxWaitMs: number
  readonly idleEvictMs: number
  readonly expirySweepIntervalMs: number
  readonly shutdownFlushTimeoutMs: number
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/u.test(raw.trim())) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loadStateSyncConfig(env: NodeJS.ProcessEnv = process.env): StateSyncLimitsConfig {
  return {
    maxDocBytes: STATE_SYNC_DOC_MAX_BYTES,
    maxWriteBytes: STATE_SYNC_WRITE_MAX_BYTES,
    maxWsFrameBytes: STATE_SYNC_WS_FRAME_MAX_BYTES,
    maxHttpBodyBytes: STATE_SYNC_DOC_MAX_BYTES,
    maxMetaBytes: STATE_SYNC_META_MAX_BYTES,
    maxPathDepth: STATE_SYNC_MAX_PATH_DEPTH,
    maxValueDepth: STATE_SYNC_MAX_VALUE_DEPTH,
    maxSubscribedPaths: STATE_SYNC_MAX_SUBSCRIBED_PATHS,
    maxOnDisconnectActions: STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS,
    defaultMaxDocsPerSpace: positiveInt(env.STATE_SYNC_DEFAULT_MAX_DOCS_PER_SPACE, STATE_SYNC_MAX_DOCS_DEFAULT),
    maxDocsPerSpaceCap: positiveInt(env.STATE_SYNC_MAX_DOCS_PER_SPACE_CAP, STATE_SYNC_MAX_DOCS_CAP),
    maxTokensPerSpace: positiveInt(env.STATE_SYNC_MAX_TOKENS_PER_SPACE, 20),
    maxConnectionsPerDoc: positiveInt(env.STATE_SYNC_MAX_CONNECTIONS_PER_DOC, 50),
    maxObserversPerDoc: positiveInt(env.STATE_SYNC_MAX_OBSERVERS_PER_DOC, 5),
    maxConnectionsPerSpace: positiveInt(env.STATE_SYNC_MAX_CONNECTIONS_PER_SPACE, 200),
    maxConnectionsPerAccount: positiveInt(env.STATE_SYNC_MAX_CONNECTIONS_PER_ACCOUNT, 300),
    maxGlobalConnections: positiveInt(env.STATE_SYNC_MAX_GLOBAL_CONNECTIONS, 2000),
    wsRatePerSec: positiveInt(env.STATE_SYNC_WS_RATE_PER_SEC, 20),
    wsBurst: positiveInt(env.STATE_SYNC_WS_BURST, 60),
    docWriteRatePerSec: positiveInt(env.STATE_SYNC_DOC_WRITE_RATE_PER_SEC, 60),
    docWriteBurst: positiveInt(env.STATE_SYNC_DOC_WRITE_BURST, 120),
    docCreateRatePerMin: positiveInt(env.STATE_SYNC_DOC_CREATE_RATE_PER_MIN, 10),
    docCreateBurst: positiveInt(env.STATE_SYNC_DOC_CREATE_BURST, 30),
    authTimeoutMs: positiveInt(env.STATE_SYNC_AUTH_TIMEOUT_MS, 5000),
    heartbeatIntervalMs: positiveInt(env.STATE_SYNC_HEARTBEAT_INTERVAL_MS, 25000),
    maxMissedHeartbeats: positiveInt(env.STATE_SYNC_MAX_MISSED_HEARTBEATS, 2),
    slowConsumerBytes: positiveInt(env.STATE_SYNC_SLOW_CONSUMER_BYTES, 524288),
    replayMaxItems: positiveInt(env.STATE_SYNC_REPLAY_MAX_ITEMS, 100),
    replayWindowMs: positiveInt(env.STATE_SYNC_REPLAY_WINDOW_MS, 300000),
    flushDebounceMs: positiveInt(env.STATE_SYNC_FLUSH_DEBOUNCE_MS, 500),
    flushMaxWaitMs: positiveInt(env.STATE_SYNC_FLUSH_MAX_WAIT_MS, 2000),
    idleEvictMs: positiveInt(env.STATE_SYNC_IDLE_EVICT_MS, 300000),
    expirySweepIntervalMs: positiveInt(env.STATE_SYNC_EXPIRY_SWEEP_INTERVAL_MS, 300000),
    shutdownFlushTimeoutMs: positiveInt(env.STATE_SYNC_SHUTDOWN_FLUSH_TIMEOUT_MS, 5000),
  }
}
