export function gameTestDatabaseUrl(): string | undefined {
  const value = process.env.GAME_E2E_DATABASE_URL
  if (!value) return undefined
  const url = new URL(value)
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !decodeURIComponent(url.pathname).endsWith("_e2e")
  )
    throw new Error("GAME_E2E_DATABASE_URL只允许本机_e2e专用测试库")
  return value
}
import { PrismaClient } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"

/** Explicit pre-chips-v2 fixtures; never mutate immutable room rules after creation. */
export function legacyGameTestClient(url: string): PrismaService {
  return new PrismaClient({ datasources: { db: { url } } }).$extends({ query: { gamePokerRoom: { create({ args, query }) {
    if (args.data.cardRulesVersion) throw new Error("Legacy fixture cannot create a card room")
    args.data.chipRulesVersion = null
    return query(args)
  } } } }) as unknown as PrismaService
}
