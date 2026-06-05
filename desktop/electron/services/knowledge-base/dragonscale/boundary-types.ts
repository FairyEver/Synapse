export const DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS = 30 as const
export const DRAGONSCALE_BOUNDARY_DEFAULT_TOP = 10 as const
export const DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES = 256 * 1024

export interface DragonScaleBoundaryScoreOptions {
  readonly top?: number
  readonly includeScoreZero?: boolean
  readonly page?: string
  readonly today?: string
}

export interface DragonScaleBoundaryScoreResult {
  readonly title: string
  readonly titleKey: string
  readonly path: string
  readonly outDegree: number
  readonly inDegree: number
  readonly ageDays: number
  readonly recencyWeight: number
  readonly score: number
}

export interface DragonScaleBoundaryScoreReport {
  readonly generated: string
  readonly halflifeDays: typeof DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS
  readonly pageCountScoreable: number
  readonly skipped: Record<string, number>
  readonly results: readonly DragonScaleBoundaryScoreResult[]
}
