import { CHANNEL_PAYLOAD_MAX_BYTES, CHANNEL_WS_FRAME_MAX_BYTES } from "@synapse/shared/channel-contracts"

export type ChannelLimitsConfig = {
  readonly maxPayloadBytes: number
  readonly maxWsFrameBytes: number
  readonly maxHttpBodyBytes: number
  readonly maxConnectionsPerChannel: number
  readonly maxObserversPerChannel: number
  readonly maxConnectionsPerAccount: number
  readonly maxGlobalConnections: number
  readonly authTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly maxMissedHeartbeats: number
  readonly slowConsumerBytes: number
  readonly replayMaxItems: number
  readonly replayWindowMs: number
  readonly wsRatePerSec: number
  readonly wsBurst: number
  readonly httpRatePerSec: number
  readonly httpBurst: number
  readonly maxTokensPerChannel: number
  readonly maxRetainedPerChannel: number
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/u.test(raw.trim())) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loadChannelConfig(env: NodeJS.ProcessEnv = process.env): ChannelLimitsConfig {
  return {
    maxPayloadBytes: CHANNEL_PAYLOAD_MAX_BYTES,
    maxWsFrameBytes: CHANNEL_WS_FRAME_MAX_BYTES,
    maxHttpBodyBytes: 131072,
    maxConnectionsPerChannel: positiveInt(env.CHANNELS_MAX_CONNECTIONS_PER_CHANNEL, 100),
    maxObserversPerChannel: positiveInt(env.CHANNELS_MAX_OBSERVERS_PER_CHANNEL, 5),
    maxConnectionsPerAccount: positiveInt(env.CHANNELS_MAX_CONNECTIONS_PER_ACCOUNT, 300),
    maxGlobalConnections: positiveInt(env.CHANNELS_MAX_GLOBAL_CONNECTIONS, 2000),
    authTimeoutMs: positiveInt(env.CHANNELS_AUTH_TIMEOUT_MS, 5000),
    heartbeatIntervalMs: positiveInt(env.CHANNELS_HEARTBEAT_INTERVAL_MS, 25000),
    maxMissedHeartbeats: positiveInt(env.CHANNELS_MAX_MISSED_HEARTBEATS, 2),
    slowConsumerBytes: positiveInt(env.CHANNELS_SLOW_CONSUMER_BYTES, 524288),
    replayMaxItems: positiveInt(env.CHANNELS_REPLAY_MAX_ITEMS, 100),
    replayWindowMs: positiveInt(env.CHANNELS_REPLAY_WINDOW_MS, 300000),
    wsRatePerSec: positiveInt(env.CHANNELS_WS_RATE_PER_SEC, 10),
    wsBurst: positiveInt(env.CHANNELS_WS_BURST, 30),
    httpRatePerSec: positiveInt(env.CHANNELS_HTTP_RATE_PER_SEC, 30),
    httpBurst: positiveInt(env.CHANNELS_HTTP_BURST, 60),
    maxTokensPerChannel: positiveInt(env.CHANNELS_MAX_TOKENS_PER_CHANNEL, 20),
    maxRetainedPerChannel: positiveInt(env.CHANNELS_MAX_RETAINED_PER_CHANNEL, 20),
  }
}
