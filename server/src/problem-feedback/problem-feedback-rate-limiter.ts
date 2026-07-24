import { Inject, Injectable, Optional } from "@nestjs/common"
import ipaddr from "ipaddr.js"
import {
  PROBLEM_FEEDBACK_GLOBAL_BUCKET,
  PROBLEM_FEEDBACK_NETWORK_BUCKET,
} from "./problem-feedback.constants"

interface BucketState {
  tokens: number
  updatedAt: number
  lastActiveAt: number
}

type Clock = () => number

const IDLE_BUCKET_TTL_MS = 60 * 60 * 1000
export const problemFeedbackClockToken = Symbol("problemFeedbackClock")

@Injectable()
export class ProblemFeedbackRateLimiter {
  private readonly networkBuckets = new Map<string, BucketState>()
  private readonly globalBucket: BucketState

  private readonly now: Clock

  constructor(
    @Optional() @Inject(problemFeedbackClockToken) now?: Clock,
  ) {
    this.now = now ?? (() => performance.now())
    const timestamp = this.now()
    this.globalBucket = {
      tokens: PROBLEM_FEEDBACK_GLOBAL_BUCKET.capacity,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    }
  }

  tryAcquire(address: string | undefined): boolean {
    const timestamp = this.now()
    this.cleanupIdleBuckets(timestamp)
    const key = normalizeProblemFeedbackAddress(address)
    const network = this.networkBuckets.get(key) ?? {
      tokens: PROBLEM_FEEDBACK_NETWORK_BUCKET.capacity,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    }
    const networkTokens = refillTokens(
      network,
      PROBLEM_FEEDBACK_NETWORK_BUCKET.capacity,
      PROBLEM_FEEDBACK_NETWORK_BUCKET.refillIntervalMs,
      timestamp,
    )
    const globalTokens = refillTokens(
      this.globalBucket,
      PROBLEM_FEEDBACK_GLOBAL_BUCKET.capacity,
      PROBLEM_FEEDBACK_GLOBAL_BUCKET.refillIntervalMs,
      timestamp,
    )

    network.tokens = networkTokens
    network.updatedAt = timestamp
    network.lastActiveAt = timestamp
    this.globalBucket.tokens = globalTokens
    this.globalBucket.updatedAt = timestamp
    this.globalBucket.lastActiveAt = timestamp
    this.networkBuckets.set(key, network)

    if (networkTokens < 1 || globalTokens < 1) return false
    network.tokens -= 1
    this.globalBucket.tokens -= 1
    return true
  }

  getNetworkBucketCount(): number {
    return this.networkBuckets.size
  }

  private cleanupIdleBuckets(timestamp: number): void {
    for (const [key, bucket] of this.networkBuckets) {
      if (timestamp - bucket.lastActiveAt >= IDLE_BUCKET_TTL_MS) {
        this.networkBuckets.delete(key)
      }
    }
  }
}

export function normalizeProblemFeedbackAddress(address: string | undefined): string {
  if (!address) return "unknown"
  const withoutZone = stripAddressPort(address.trim()).replace(/%[^\]]+$/u, "")
  try {
    const parsed = ipaddr.parse(withoutZone)
    if (parsed.kind() === "ipv4") return parsed.toString()
    const ipv6 = parsed as ipaddr.IPv6
    if (ipv6.isIPv4MappedAddress()) {
      return ipv6.toIPv4Address().toString()
    }
    const network = ipaddr.IPv6.parse(
      [...ipv6.parts.slice(0, 4), 0, 0, 0, 0]
        .map((part) => part.toString(16))
        .join(":"),
    )
    return `${network.toString()}/64`
  } catch {
    return "unknown"
  }
}

function stripAddressPort(value: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/u.exec(value)
  if (bracketed) return bracketed[1] ?? value
  const ipv4WithPort = /^((?:\d{1,3}\.){3}\d{1,3}):\d+$/u.exec(value)
  return ipv4WithPort?.[1] ?? value
}

function refillTokens(
  bucket: BucketState,
  capacity: number,
  refillIntervalMs: number,
  timestamp: number,
): number {
  return Math.min(
    capacity,
    bucket.tokens + Math.max(0, timestamp - bucket.updatedAt) / refillIntervalMs,
  )
}
