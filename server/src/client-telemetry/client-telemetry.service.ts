import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import {
  CLIENT_TELEMETRY_FILTER_OPTION_LIMIT,
  CLIENT_TELEMETRY_RETENTION_DAYS,
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

type ActiveInsightRow = {
  dau: bigint
  wau: bigint
  mau: bigint
}

type SessionInsightRow = {
  averageDurationMs: number | null
  p95DurationMs: number | null
}

type IdentityInsightRow = {
  newIdentities: bigint
  returningIdentities: bigint
}

type AdoptionInsightRow = {
  featureKey: string
  identities: bigint
  sessions: bigint
  events: bigint
  successes: bigint
  completed: bigint
}

type FunnelInsightRow = {
  funnelKey: string
  stageKey: string
  stageIndex: number
  identities: bigint
}

type RetentionInsightRow = {
  cohortDate: string
  cohortSize: bigint
  day1: bigint
  day7: bigint
  day30: bigint
  day1Mature: boolean
  day7Mature: boolean
  day30Mature: boolean
}

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
      activeInsightRows,
      sessionInsightRows,
      identityInsightRows,
      adoptionInsightRows,
      funnelInsightRows,
      retentionInsightRows,
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
      this.activeInsights(query),
      this.sessionInsights(query),
      this.identityInsights(query),
      this.adoptionInsights(query),
      this.funnelInsights(query),
      this.retentionInsights(query),
    ])

    const summary = summaryRows[0]
    const completedOperations = Number(summary?.completedOperations ?? 0)
    const failures = Number(summary?.failures ?? 0)
    const active = activeInsightRows[0]
    const sessions = sessionInsightRows[0]
    const identities = identityInsightRows[0]
    const dau = Number(active?.dau ?? 0)
    const mau = Number(active?.mau ?? 0)
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
      insights: {
        active: {
          dau,
          wau: Number(active?.wau ?? 0),
          mau,
          stickiness: mau > 0 ? dau / mau : 0,
        },
        sessions: {
          averageDurationMs: roundedNullable(sessions?.averageDurationMs),
          p95DurationMs: roundedNullable(sessions?.p95DurationMs),
        },
        identities: {
          new: Number(identities?.newIdentities ?? 0),
          returning: Number(identities?.returningIdentities ?? 0),
        },
        adoption: adoptionInsightRows.map((row) => {
          const completed = Number(row.completed)
          return {
            featureKey: row.featureKey,
            identities: Number(row.identities),
            sessions: Number(row.sessions),
            events: Number(row.events),
            successRate: completed > 0 ? Number(row.successes) / completed : null,
          }
        }),
        funnels: buildFunnelInsights(funnelInsightRows),
        retention: retentionInsightRows.map((row) => ({
          cohortDate: row.cohortDate,
          cohortSize: Number(row.cohortSize),
          day1Rate: retentionRate(row.day1, row.cohortSize, row.day1Mature),
          day7Rate: retentionRate(row.day7, row.cohortSize, row.day7Mature),
          day30Rate: retentionRate(row.day30, row.cohortSize, row.day30Mature),
        })),
      },
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

  private activeInsights(query: ClientTelemetryStatsQuery) {
    const where = buildWhereWithoutRange(query)
    const activityFloor = new Date(query.to.getTime() - 30 * 24 * 60 * 60 * 1000)
    return this.prisma.$queryRaw<ActiveInsightRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT ${identitySql()} AS "identityKey", "occurredAt"
        FROM "ClientTelemetryEvent"
        ${where}
          AND "occurredAt" >= ${activityFloor}
          AND "occurredAt" < ${query.to}
      )
      SELECT
        COUNT(DISTINCT "identityKey") FILTER (WHERE "occurredAt" >= ${query.to} - INTERVAL '1 day') AS "dau",
        COUNT(DISTINCT "identityKey") FILTER (WHERE "occurredAt" >= ${query.to} - INTERVAL '7 days') AS "wau",
        COUNT(DISTINCT "identityKey") FILTER (WHERE "occurredAt" >= ${query.to} - INTERVAL '30 days') AS "mau"
      FROM filtered
    `)
  }

  private sessionInsights(query: ClientTelemetryStatsQuery) {
    const where = buildWhere(query)
    return this.prisma.$queryRaw<SessionInsightRow[]>(Prisma.sql`
      WITH durations AS (
        SELECT EXTRACT(EPOCH FROM (MAX("occurredAt") - MIN("occurredAt"))) * 1000 AS "durationMs"
        FROM "ClientTelemetryEvent"
        ${where}
        GROUP BY ${identitySql()}, "sessionId"
      )
      SELECT
        AVG("durationMs") AS "averageDurationMs",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS "p95DurationMs"
      FROM durations
    `)
  }

  private identityInsights(query: ClientTelemetryStatsQuery) {
    const currentWhere = buildWhere(query)
    const historyWhere = buildWhereWithoutRange(query)
    const retentionFloor = new Date(query.to.getTime() - CLIENT_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    return this.prisma.$queryRaw<IdentityInsightRow[]>(Prisma.sql`
      WITH current_identities AS (
        SELECT DISTINCT ${identitySql()} AS "identityKey"
        FROM "ClientTelemetryEvent"
        ${currentWhere}
      ), first_seen AS (
        SELECT ${identitySql()} AS "identityKey", MIN("occurredAt") AS "firstSeenAt"
        FROM "ClientTelemetryEvent"
        ${historyWhere}
          AND "occurredAt" >= ${retentionFloor}
          AND "occurredAt" < ${query.to}
        GROUP BY 1
      )
      SELECT
        COUNT(*) FILTER (WHERE first_seen."firstSeenAt" >= ${query.from}) AS "newIdentities",
        COUNT(*) FILTER (WHERE first_seen."firstSeenAt" < ${query.from}) AS "returningIdentities"
      FROM current_identities
      JOIN first_seen USING ("identityKey")
    `)
  }

  private adoptionInsights(query: ClientTelemetryStatsQuery) {
    const where = buildWhere(query)
    return this.prisma.$queryRaw<AdoptionInsightRow[]>(Prisma.sql`
      WITH features AS (
        SELECT
          ${identitySql()} AS "identityKey",
          "sessionId",
          "outcome",
          CASE
            WHEN "eventKey" LIKE 'web.drive.%upload%' OR "eventKey" LIKE 'drive.%upload%' THEN 'drive.upload'
            WHEN "eventKey" LIKE 'web.drive.%share%' OR "eventKey" LIKE 'drive.%share%' THEN 'drive.share'
            WHEN "eventKey" LIKE 'web.drive.%editor%' OR "eventKey" LIKE 'web.drive.%save%' THEN 'drive.edit'
            WHEN "eventKey" LIKE 'drive.sync.%' THEN 'drive.sync'
            WHEN "eventKey" LIKE 'git.%' OR "moduleId" = 'git' THEN 'git'
            WHEN "eventKey" LIKE 'workflow.%' OR "moduleId" = 'workflow' THEN 'workflow'
            WHEN "eventKey" LIKE 'agent.%' OR "moduleId" = 'agent' THEN 'agent'
            WHEN "eventKey" LIKE 'automation.%' OR "moduleId" = 'automation' THEN 'automation'
            WHEN "eventKey" LIKE 'terminal.%' OR "moduleId" = 'terminal' THEN 'terminal'
            WHEN "eventKey" LIKE 'secrets.%' OR "moduleId" = 'secrets' THEN 'secrets'
            WHEN "eventKey" LIKE 'installer.%' OR "eventKey" LIKE 'skill-installer.%' OR "eventKey" LIKE 'rule-installer.%' THEN 'installers'
            ELSE COALESCE("moduleId", split_part("eventKey", '.', 1))
          END AS "featureKey"
        FROM "ClientTelemetryEvent"
        ${where}
      )
      SELECT
        "featureKey",
        COUNT(DISTINCT "identityKey") AS "identities",
        COUNT(DISTINCT "sessionId") AS "sessions",
        COUNT(*) AS "events",
        COUNT(*) FILTER (WHERE "outcome" = 'success') AS "successes",
        COUNT(*) FILTER (WHERE "outcome" IN ('success', 'failure')) AS "completed"
      FROM features
      WHERE "featureKey" IS NOT NULL
      GROUP BY "featureKey"
      ORDER BY "identities" DESC, "events" DESC, "featureKey" ASC
      LIMIT 20
    `)
  }

  private funnelInsights(query: ClientTelemetryStatsQuery) {
    const where = buildWhere(query)
    return this.prisma.$queryRaw<FunnelInsightRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT ${identitySql()} AS "identityKey", "sessionId", "occurredAt", "eventKey", "action", "outcome"
        FROM "ClientTelemetryEvent"
        ${where}
      ), mapped AS (
        SELECT *, 'drive-upload' AS "funnelKey", 'start' AS "stageKey", 1 AS "stageIndex" FROM filtered
          WHERE ("eventKey" LIKE 'drive.%upload%' OR "eventKey" LIKE 'web.drive.%upload%') AND "outcome" IS NULL
        UNION ALL SELECT *, 'drive-upload', 'success', 2 FROM filtered
          WHERE ("eventKey" LIKE 'drive.%upload%' OR "eventKey" LIKE 'web.drive.%upload%') AND "outcome" = 'success'
        UNION ALL SELECT *, 'drive-share', 'open', 1 FROM filtered
          WHERE ("eventKey" LIKE 'drive.%share%' OR "eventKey" LIKE 'web.drive.%share%') AND "outcome" IS NULL
        UNION ALL SELECT *, 'drive-share', 'success', 2 FROM filtered
          WHERE ("eventKey" LIKE 'drive.%share%' OR "eventKey" LIKE 'web.drive.%share%') AND "outcome" = 'success'
        UNION ALL SELECT *, 'drive-edit', 'open', 1 FROM filtered
          WHERE "eventKey" IN ('web.drive.editor.open', 'web.drive.preview.edit')
        UNION ALL SELECT *, 'drive-edit', 'save', 2 FROM filtered
          WHERE "eventKey" IN ('web.drive.editor.save', 'web.drive.operation.browser.save-text') AND "outcome" = 'success'
        UNION ALL SELECT *, 'drive-sync', 'open', 1 FROM filtered WHERE "eventKey" = 'drive.sync.dialog.open'
        UNION ALL SELECT *, 'drive-sync', 'bound', 2 FROM filtered WHERE "eventKey" = 'drive.sync.binding.create' AND "outcome" = 'success'
        UNION ALL SELECT *, 'git-publish', 'repository', 1 FROM filtered
          WHERE "eventKey" IN ('git.repository.clone', 'git.repository.add-local', 'git.repository.initialize') AND "outcome" = 'success'
        UNION ALL SELECT *, 'git-publish', 'commit', 2 FROM filtered WHERE "eventKey" = 'git.commit' AND "outcome" = 'success'
        UNION ALL SELECT *, 'git-publish', 'push', 3 FROM filtered WHERE "eventKey" = 'git.repository.push' AND "outcome" = 'success'
        UNION ALL SELECT *, 'workflow-run', 'create', 1 FROM filtered WHERE "eventKey" = 'workflow.create' AND "outcome" = 'success'
        UNION ALL SELECT *, 'workflow-run', 'run', 2 FROM filtered WHERE "eventKey" = 'workflow.editor.run' AND "outcome" = 'success'
        UNION ALL SELECT *, 'agent-response', 'session', 1 FROM filtered WHERE "eventKey" = 'agent.session.create' AND "outcome" = 'success'
        UNION ALL SELECT *, 'agent-response', 'message', 2 FROM filtered WHERE "eventKey" = 'agent.message.submit' AND "outcome" = 'success'
        UNION ALL SELECT *, 'agent-response', 'response', 3 FROM filtered WHERE "eventKey" = 'agent.response.complete' AND "outcome" = 'success'
      ), stage_times AS (
        SELECT "identityKey", "sessionId", "funnelKey", "stageKey", "stageIndex", MIN("occurredAt") AS "stageAt"
        FROM mapped
        GROUP BY 1, 2, 3, 4, 5
      ), completed AS (
        SELECT current.*
        FROM stage_times current
        WHERE current."stageIndex" = 1 OR NOT EXISTS (
          SELECT 1 FROM generate_series(1, current."stageIndex" - 1) expected("stageIndex")
          WHERE NOT EXISTS (
            SELECT 1 FROM stage_times previous
            WHERE previous."identityKey" = current."identityKey"
              AND previous."sessionId" = current."sessionId"
              AND previous."funnelKey" = current."funnelKey"
              AND previous."stageIndex" = expected."stageIndex"
              AND previous."stageAt" <= current."stageAt"
          )
        )
      )
      SELECT "funnelKey", "stageKey", "stageIndex", COUNT(DISTINCT "identityKey") AS "identities"
      FROM completed
      GROUP BY 1, 2, 3
      ORDER BY 1, 3
    `)
  }

  private retentionInsights(query: ClientTelemetryStatsQuery) {
    const historyWhere = buildWhereWithoutRange(query)
    const retentionFloor = new Date(query.to.getTime() - CLIENT_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    return this.prisma.$queryRaw<RetentionInsightRow[]>(Prisma.sql`
      WITH activity AS (
        SELECT DISTINCT
          ${identitySql()} AS "identityKey",
          date_trunc('day', "occurredAt" + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date AS "activityDate"
        FROM "ClientTelemetryEvent"
        ${historyWhere}
          AND "occurredAt" >= ${retentionFloor}
          AND "occurredAt" < ${query.to}
      ), cohorts AS (
        SELECT "identityKey", MIN("activityDate") AS "cohortDate"
        FROM activity
        GROUP BY 1
      )
      SELECT
        to_char(cohorts."cohortDate", 'YYYY-MM-DD') AS "cohortDate",
        COUNT(*) AS "cohortSize",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity WHERE activity."identityKey" = cohorts."identityKey" AND activity."activityDate" = cohorts."cohortDate" + 1)) AS "day1",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity WHERE activity."identityKey" = cohorts."identityKey" AND activity."activityDate" = cohorts."cohortDate" + 7)) AS "day7",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity WHERE activity."identityKey" = cohorts."identityKey" AND activity."activityDate" = cohorts."cohortDate" + 30)) AS "day30",
        cohorts."cohortDate" + 1 < (${query.to} + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date AS "day1Mature",
        cohorts."cohortDate" + 7 < (${query.to} + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date AS "day7Mature",
        cohorts."cohortDate" + 30 < (${query.to} + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date AS "day30Mature"
      FROM cohorts
      WHERE cohorts."cohortDate" >= (${query.from} + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date
        AND cohorts."cohortDate" < (${query.to} + ${query.timezoneOffsetMinutes} * INTERVAL '1 minute')::date
      GROUP BY cohorts."cohortDate"
      ORDER BY cohorts."cohortDate" ASC
    `)
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

function buildWhereWithoutRange(query: ClientTelemetryStatsQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (query.identity === "authenticated") conditions.push(Prisma.sql`"userId" IS NOT NULL`)
  if (query.identity === "anonymous") conditions.push(Prisma.sql`"userId" IS NULL`)
  if (query.userId) conditions.push(Prisma.sql`"userId" = ${query.userId}`)
  if (query.moduleId) conditions.push(Prisma.sql`"moduleId" = ${query.moduleId}`)
  if (query.eventKey) conditions.push(Prisma.sql`"eventKey" = ${query.eventKey}`)
  if (query.appVersion) conditions.push(Prisma.sql`"appVersion" = ${query.appVersion}`)
  if (query.platform) conditions.push(Prisma.sql`"platform" = ${query.platform}`)
  if (query.windowType) conditions.push(Prisma.sql`"windowType" = ${query.windowType}`)
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
}

function identitySql(): Prisma.Sql {
  return Prisma.sql`COALESCE('u:' || "userId", 'c:' || "clientInstanceId")`
}

function roundedNullable(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(Number(value))
}

function retentionRate(retained: bigint, cohortSize: bigint, mature: boolean): number | null {
  if (!mature) return null
  const size = Number(cohortSize)
  return size > 0 ? Number(retained) / size : 0
}

function buildFunnelInsights(rows: readonly FunnelInsightRow[]) {
  const funnels = new Map<string, FunnelInsightRow[]>()
  for (const row of rows) {
    const current = funnels.get(row.funnelKey) ?? []
    current.push(row)
    funnels.set(row.funnelKey, current)
  }
  return [...funnels.entries()].map(([funnelKey, stages]) => {
    const ordered = stages.sort((left, right) => left.stageIndex - right.stageIndex)
    const start = Number(ordered[0]?.identities ?? 0)
    return {
      funnelKey,
      stages: ordered.map((stage, index) => {
        const identities = Number(stage.identities)
        const previous = index === 0 ? identities : Number(ordered[index - 1]?.identities ?? 0)
        return {
          stageKey: stage.stageKey,
          identities,
          conversionFromStart: start > 0 ? identities / start : 0,
          conversionFromPrevious: previous > 0 ? identities / previous : 0,
        }
      }),
    }
  })
}
