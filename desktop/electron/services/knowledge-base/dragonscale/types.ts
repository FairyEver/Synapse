export type DragonScaleAddress = `c-${string}`

export interface DragonScaleAddressAllocation {
  readonly address: DragonScaleAddress
  readonly nextCounter: number
}

export interface DragonScaleAddressServiceResult {
  readonly address: DragonScaleAddress
  readonly counterPath: string
}
