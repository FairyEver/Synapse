import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import {
  CLIENT_TELEMETRY_FILTER_OPTION_LIMIT,
  CLIENT_TELEMETRY_STATS_TOP_LIMIT,
} from "./client-telemetry.constants"
import type {
  ClientTelemetryEventInput,
  ClientTelemetryStatsQuery,
} from "./client-telemetry.schemas"

type SummaryRow = {
  events: bigint
  authenticatedUsers: bigint
  anonymousClients: bigint
  sessions: bigint
  failures: bigint
  completedOperations: bigint
  p95DurationMs: number | null
}

type TrendRow = {
  date: string
  events: bigint
  authenticatedEvents: bigint
  anonymousEvents: bigint
  activeUsers: bigint
  anonymousClients: bigint
  sessions: bigint
  failures: bigint
}

type DimensionRow = { value: string; count: bigint }

@Injectable()
export class ClientTelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(userId: string | null, events: readonly ClientTelemetryEventInput[]) {
    const result = await this.prisma.clientTelemetryEvent.createMany({
      data: events.map((event) => ({
        ...event,
        userId,
        occurredAt: new Date(event.occurredAt),
      })),
      skipDuplicates: true,
    })
    return {
      accepted: result.count,
      duplicates: events.length - result.count,
    }
  }

  async getStats(query: ClientTelemetryStatsQuery) {
    const where = buildWhere(query)
    const summaryRows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS "events",
        COUNT(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL) AS "authenticatedUsers",
        COUNT(DISTINCT "clientInstanceId") FILTER (WHERE "userId" IS NULL) AS "anonymousClients",
        COUNT(DISTINCT "sessionId") AS "sessions",
        COUNT(*) FILTER (WHERE "outcome" = 'failure') AS "failures",
        COUNT(*) FILTER (WHERE "outcome" IN ('success', 'failure')) AS "completedOperations",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
          FILTER (WHERE "durationMs" IS NOT NULL AND "outcome" IN ('success', 'failure')) AS "p95DurationMs"
      FROM "ClientTelemetryEvent"
      ${where}
    `)
    const trendRows = await this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      SELECT
        to_char(date_trunc('day', "occurredAt" + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute'), 'YYYY-MM-DD') AS "date",
        COUNT(*) AS "events",
        COUNT(*) FILTER (WHERE "userId" IS NOT NULL) AS "authenticatedEvents",
        COUNT(*) FILTER (WHERE "userId" IS NULL) AS "anonymousEvents",
        COUNT(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL) AS "activeUsers",
        COUNT(DISTINCT "clientInstanceId") FILTER (WHERE "userId" IS NULL) AS "anonymousClients",
        COUNT(DISTINCT "sessionId") AS "sessions",
        COUNT(*) FILTER (WHERE "outcome" = 'failure') AS "failures"
      FROM "ClientTelemetryEvent"
      ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `)

    const [
      modules,
      events,
      actions,
      outcomes,
      versions,
      platforms,
      windowTypes,
      moduleOptions,
      eventOptions,
      versionOptions,
      platformOptions,
      windowTypeOptions,
    ] = await Promise.all([
      this.topDimension("moduleId", where),
      this.topDimension("eventKey", where),
      this.topDimension("action", where),
      this.topDimension("outcome", where),
      this.topDimension("appVersion", where),
      this.topDimension("platform", where),
      this.topDimension("windowType", where),
      this.filterOptions("moduleId", query),
      this.filterOptions("eventKey", query),
      this.filterOptions("appVersion", query),
      this.filterOptions("platform", query),
      this.filterOptions("windowType", query),
    ])

    const summary = summaryRows[0]
    const completedOperations = Number(summary?.completedOperations ?? 0)
    const failures = Number(summary?.failures ?? 0)
    return {
      range: {
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        timezoneOffsetMinutes: query.timezoneOffsetMinutes,
        interval: "day" as const,
      },
      summary: {
        events: Number(summary?.events ?? 0),
        authenticatedUsers: Number(summary?.authenticatedUsers ?? 0),
        anonymousClients: Number(summary?.anonymousClients ?? 0),
        sessions: Number(summary?.sessions ?? 0),
        failures,
        failureRate: completedOperations > 0 ? failures / completedOperations : 0,
        p95DurationMs: summary?.p95DurationMs === null || summary?.p95DurationMs === undefined
          ? null
          : Math.round(Number(summary.p95DurationMs)),
      },
      trend: trendRows.map((row) => ({
        date: row.date,
        events: Number(row.events),
        authenticatedEvents: Number(row.authenticatedEvents),
        anonymousEvents: Number(row.anonymousEvents),
        activeUsers: Number(row.activeUsers),
        anonymousClients: Number(row.anonymousClients),
        sessions: Number(row.sessions),
        failures: Number(row.failures),
      })),
      dimensions: { modules, events, actions, outcomes, versions, platforms, windowTypes },
      filterOptions: {
        modules: moduleOptions,
        events: eventOptions,
        versions: versionOptions,
        platforms: platformOptions,
        windowTypes: windowTypeOptions,
      },
    }
  }

  private async topDimension(column: DimensionColumn, where: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<DimensionRow[]>(Prisma.sql`
      SELECT ${Prisma.raw(`"${column}"`)} AS "value", COUNT(*) AS "count"
      FROM "ClientTelemetryEvent"
      ${where}
      AND ${Prisma.raw(`"${column}"`)} IS NOT NULL
      GROUP BY ${Prisma.raw(`"${column}"`)}
      ORDER BY "count" DESC, "value" ASC
      LIMIT ${CLIENT_TELEMETRY_STATS_TOP_LIMIT}
    `)
    return rows.map((row) => ({ value: row.value, count: Number(row.count) }))
  }

  private async filterOptions(column: FilterColumn, query: ClientTelemetryStatsQuery) {
    const where = buildWhere(query, column)
    const rows = await this.prisma.$queryRaw<DimensionRow[]>(Prisma.sql`
      SELECT ${Prisma.raw(`"${column}"`)} AS "value", COUNT(*) AS "count"
      FROM "ClientTelemetryEvent"
      ${where}
      AND ${Prisma.raw(`"${column}"`)} IS NOT NULL
      GROUP BY ${Prisma.raw(`"${column}"`)}
      ORDER BY "count" DESC, "value" ASC
      LIMIT ${CLIENT_TELEMETRY_FILTER_OPTION_LIMIT}
    `)
    return rows.map((row) => ({ value: row.value, count: Number(row.count) }))
  }
}

type DimensionColumn =
  | "moduleId"
  | "eventKey"
  | "action"
  | "outcome"
  | "appVersion"
  | "platform"
  | "windowType"

type FilterColumn = "moduleId" | "eventKey" | "appVersion" | "platform" | "windowType"

function buildWhere(query: ClientTelemetryStatsQuery, omittedColumn?: FilterColumn): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"occurredAt" >= ${query.from}`,
    Prisma.sql`"occurredAt" < ${query.to}`,
  ]
  if (query.identity === "authenticated") conditions.push(Prisma.sql`"userId" IS NOT NULL`)
  if (query.identity === "anonymous") conditions.push(Prisma.sql`"userId" IS NULL`)
  if (query.userId) conditions.push(Prisma.sql`"userId" = ${query.userId}`)
  if (query.moduleId && omittedColumn !== "moduleId") conditions.push(Prisma.sql`"moduleId" = ${query.moduleId}`)
  if (query.eventKey && omittedColumn !== "eventKey") conditions.push(Prisma.sql`"eventKey" = ${query.eventKey}`)
  if (query.appVersion && omittedColumn !== "appVersion") conditions.push(Prisma.sql`"appVersion" = ${query.appVersion}`)
  if (query.platform && omittedColumn !== "platform") conditions.push(Prisma.sql`"platform" = ${query.platform}`)
  if (query.windowType && omittedColumn !== "windowType") conditions.push(Prisma.sql`"windowType" = ${query.windowType}`)
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
}
