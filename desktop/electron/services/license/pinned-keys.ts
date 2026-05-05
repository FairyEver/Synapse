export interface PinnedKey {
  readonly keyId: string
  readonly publicKey: string
}

const PINNED_KEYS: readonly PinnedKey[] = [
  {
    keyId: "prod-key-001",
    publicKey: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAxRC/kjqBTMQe19knP5l1byx/jh8xTFLkXQjTbj5NOQw=",
      "-----END PUBLIC KEY-----",
    ].join("\n"),
  },
]

export function findPinnedKey(keyId: string): PinnedKey | null {
  return PINNED_KEYS.find((key) => key.keyId === keyId) ?? null
}

export function hasPinnedKeys(): boolean {
  return PINNED_KEYS.length > 0
}
