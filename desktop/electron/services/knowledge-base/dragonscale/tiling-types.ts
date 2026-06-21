export const DRAGONSCALE_TILING_DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
export const DRAGONSCALE_TILING_DEFAULT_MODEL = "nomic-embed-text"
export const DRAGONSCALE_TILING_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
export const DRAGONSCALE_TILING_MAX_BODY_BYTES = 128 * 1024
export const DRAGONSCALE_TILING_SCALE_WARN_PAGES = 500
export const DRAGONSCALE_TILING_SCALE_HARD_FAIL_PAGES = 5000
export const DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS = 500_000
export const DRAGONSCALE_TILING_MAX_REPORT_PAIRS_PER_BAND = 200

export type DragonScaleTilingStatus =
  | "ok"
  | "usage-error"
  | "cache-corrupt"
  | "scale-exceeded"
  | "ollama-unreachable"
  | "model-missing"

export interface DragonScaleTilingBands {
  readonly error: number
  readonly review: number
}

export interface DragonScaleTilingThresholds {
  readonly version: 1
  readonly model: string
  readonly bands: DragonScaleTilingBands
  readonly calibrated: boolean
  readonly calibrationPairsLabeled: number
}

export interface DragonScaleTilingCheckOptions {
  readonly rebuildCache?: boolean
  readonly reportPath?: string
  readonly ollamaUrl?: string
  readonly model?: string
  readonly allowRemoteOllama?: boolean
  readonly now?: Date
}

export type DragonScaleTilingPeekOptions = Pick<
  DragonScaleTilingCheckOptions,
  "ollamaUrl" | "model" | "allowRemoteOllama"
>

export interface DragonScaleTilingPair {
  readonly similarity: number
  readonly leftPath: string
  readonly rightPath: string
}

export interface DragonScaleTilingCheckResult {
  readonly status: DragonScaleTilingStatus
  readonly generated: string
  readonly model: string
  readonly ollamaUrl: string
  readonly thresholds: DragonScaleTilingThresholds
  readonly scanned: number
  readonly embedded: number
  readonly skipped: Record<string, number>
  readonly cacheHits: number
  readonly recomputed: number
  readonly orphansPruned: number
  readonly errors: readonly DragonScaleTilingPair[]
  readonly reviews: readonly DragonScaleTilingPair[]
  readonly reportMarkdown?: string
  readonly reportPath?: string
  readonly warnings: readonly string[]
  readonly message?: string
}

export interface DragonScaleTilingPeekResult {
  readonly status: DragonScaleTilingStatus
  readonly vaultPath: string
  readonly ollamaUrl: string
  readonly ollamaReachable: boolean
  readonly modelRequested: string
  readonly modelPresent: boolean
  readonly cachePresent: boolean
  readonly cacheReadable: boolean
  readonly cacheEntries: number
  readonly cacheModel: string | null
  readonly cacheError?: string
  readonly thresholdsPresent: boolean
  readonly thresholdsReadable: boolean
  readonly thresholdsCalibrated?: boolean
  readonly thresholdsBands?: DragonScaleTilingBands
  readonly message?: string
}

export interface DragonScaleEmbeddingProvider {
  isReachable(url: string): Promise<boolean>
  hasModel(url: string, model: string): Promise<boolean>
  embed(input: {
    readonly url: string
    readonly model: string
    readonly text: string
  }): Promise<readonly number[]>
}

export interface DragonScaleTilingCacheEntry {
  readonly hash: string
  readonly embedding: readonly number[]
  readonly computed_at: string
}

export interface DragonScaleTilingCache {
  readonly version: 1
  readonly model: string
  readonly embeddings: Record<string, DragonScaleTilingCacheEntry>
}

export function defaultDragonScaleTilingThresholds(model = DRAGONSCALE_TILING_DEFAULT_MODEL): DragonScaleTilingThresholds {
  return {
    version: 1,
    model,
    bands: { error: 0.9, review: 0.8 },
    calibrated: false,
    calibrationPairsLabeled: 0,
  }
}
