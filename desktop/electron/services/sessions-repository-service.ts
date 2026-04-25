export type SessionHistoryEntry = {
  role: string
  content: string
  timestamp: string
}

export type AgentSessionRecord = {
  id: string
  name: string
  agentSessionId: string
  agentType: string
  pastAgentSessionIds: string[]
  history: SessionHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export type SessionUserMeta = {
  userName?: string
  chatName?: string
}

export type SessionsSnapshot = {
  sessions: Record<string, AgentSessionRecord>
  activeSession: Record<string, string>
  userSessions: Record<string, string[]>
  counter: number
  sessionNames?: Record<string, string>
  userMeta?: Record<string, SessionUserMeta>
}

export type FlattenedSessionRecord = {
  project: string
  sessionId: string
  globalId: string
  name: string
  platform: string
  groupUser: string
  userName: string
  chatName: string
  messages: number
  lastActive: string
  history: SessionHistoryEntry[]
}

export const CONTINUE_SESSION = "__continue__"

function nowIso(now: () => Date): string {
  return now().toISOString()
}

function cloneSession(session: AgentSessionRecord): AgentSessionRecord {
  return {
    ...session,
    pastAgentSessionIds: [...session.pastAgentSessionIds],
    history: session.history.map((entry) => ({ ...entry })),
  }
}

function newRecord(id: string, name: string, now: () => Date): AgentSessionRecord {
  const timestamp = nowIso(now)

  return {
    id,
    name,
    agentSessionId: "",
    agentType: "",
    pastAgentSessionIds: [],
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export class AgentSessionsRepository {
  private sessions = new Map<string, AgentSessionRecord>()
  private activeSession = new Map<string, string>()
  private userSessions = new Map<string, string[]>()
  private userMeta = new Map<string, SessionUserMeta>()
  private counter = 0
  private readonly now: () => Date

  constructor(options: { now?: () => Date; snapshot?: SessionsSnapshot } = {}) {
    this.now = options.now ?? (() => new Date())
    if (options.snapshot) {
      this.loadSnapshot(options.snapshot)
    }
  }

  getOrCreateActive(sessionKey: string): AgentSessionRecord {
    const activeId = this.activeSession.get(sessionKey)
    const active = activeId ? this.sessions.get(activeId) : undefined
    if (active) {
      return cloneSession(active)
    }

    return this.newSession(sessionKey)
  }

  newSession(sessionKey: string, name?: string): AgentSessionRecord {
    this.counter += 1
    const id = `s${this.counter}`
    const session = newRecord(id, name ?? id, this.now)
    this.sessions.set(id, session)
    this.activeSession.set(sessionKey, id)
    this.userSessions.set(sessionKey, [...(this.userSessions.get(sessionKey) ?? []), id])
    return cloneSession(session)
  }

  newSideSession(sessionKey: string, name?: string): AgentSessionRecord {
    this.counter += 1
    const id = `s${this.counter}`
    const session = newRecord(id, name ?? id, this.now)
    this.sessions.set(id, session)
    this.userSessions.set(sessionKey, [...(this.userSessions.get(sessionKey) ?? []), id])
    return cloneSession(session)
  }

  switchSession(sessionKey: string, sessionIdOrName: string): AgentSessionRecord {
    const candidateIds = this.userSessions.get(sessionKey) ?? []
    const session = candidateIds
      .map((id) => this.sessions.get(id))
      .find((item) => item && (item.id === sessionIdOrName || item.name === sessionIdOrName))

    if (!session) {
      throw new Error(`session not found: ${sessionIdOrName}`)
    }

    this.activeSession.set(sessionKey, session.id)
    return cloneSession(session)
  }

  switchToAgentSession(sessionKey: string, agentSessionId: string): AgentSessionRecord {
    const session = Array.from(this.sessions.values())
      .find((item) => item.agentSessionId === agentSessionId || item.pastAgentSessionIds.includes(agentSessionId))

    if (!session) {
      throw new Error(`agent session not found: ${agentSessionId}`)
    }

    this.activeSession.set(sessionKey, session.id)
    const current = this.userSessions.get(sessionKey) ?? []
    if (!current.includes(session.id)) {
      this.userSessions.set(sessionKey, [...current, session.id])
    }
    return cloneSession(session)
  }

  setAgentInfo(sessionId: string, agentType: string, agentSessionId: string): AgentSessionRecord {
    const session = this.requireSession(sessionId)
    session.agentType = agentType
    this.setAgentSessionIdInternal(session, agentSessionId === CONTINUE_SESSION ? "" : agentSessionId)
    return cloneSession(session)
  }

  setAgentSessionId(sessionId: string, agentSessionId: string): AgentSessionRecord {
    if (agentSessionId === CONTINUE_SESSION) {
      throw new Error("continue sentinel cannot be stored as agent session ID")
    }

    const session = this.requireSession(sessionId)
    this.setAgentSessionIdInternal(session, agentSessionId)
    return cloneSession(session)
  }

  compareAndSetAgentSessionId(sessionId: string, expected: string, next: string): AgentSessionRecord | null {
    if (next === CONTINUE_SESSION) {
      throw new Error("continue sentinel cannot be stored as agent session ID")
    }

    const session = this.requireSession(sessionId)
    const current = session.agentSessionId
    if (current !== expected && current !== "" && current !== CONTINUE_SESSION) {
      return null
    }

    this.setAgentSessionIdInternal(session, next)
    return cloneSession(session)
  }

  appendHistory(sessionId: string, entry: Omit<SessionHistoryEntry, "timestamp"> & { timestamp?: string }): AgentSessionRecord {
    const session = this.requireSession(sessionId)
    session.history.push({
      role: entry.role,
      content: entry.content,
      timestamp: entry.timestamp ?? nowIso(this.now),
    })
    session.updatedAt = nowIso(this.now)
    return cloneSession(session)
  }

  deleteBySessionId(sessionId: string): boolean {
    if (!this.sessions.delete(sessionId)) {
      return false
    }

    for (const [key, activeId] of this.activeSession.entries()) {
      if (activeId === sessionId) {
        this.activeSession.delete(key)
      }
    }
    for (const [key, ids] of this.userSessions.entries()) {
      this.userSessions.set(key, ids.filter((id) => id !== sessionId))
    }
    return true
  }

  deleteByAgentSessionId(agentSessionId: string): boolean {
    const session = Array.from(this.sessions.values())
      .find((item) => item.agentSessionId === agentSessionId || item.pastAgentSessionIds.includes(agentSessionId))

    return session ? this.deleteBySessionId(session.id) : false
  }

  findById(sessionId: string): AgentSessionRecord | null {
    const session = this.sessions.get(sessionId)
    return session ? cloneSession(session) : null
  }

  listSessions(): AgentSessionRecord[] {
    return Array.from(this.sessions.values())
      .map(cloneSession)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  knownAgentSessionIds(): string[] {
    const ids = new Set<string>()
    for (const session of this.sessions.values()) {
      if (session.agentSessionId) {
        ids.add(session.agentSessionId)
      }
      for (const pastId of session.pastAgentSessionIds) {
        ids.add(pastId)
      }
    }
    return Array.from(ids)
  }

  setUserMeta(sessionKey: string, meta: SessionUserMeta): void {
    this.userMeta.set(sessionKey, meta)
  }

  snapshot(): SessionsSnapshot {
    return {
      sessions: Object.fromEntries(Array.from(this.sessions.entries()).map(([key, value]) => [key, cloneSession(value)])),
      activeSession: Object.fromEntries(this.activeSession),
      userSessions: Object.fromEntries(Array.from(this.userSessions.entries()).map(([key, value]) => [key, [...value]])),
      counter: this.counter,
      userMeta: Object.fromEntries(this.userMeta),
    }
  }

  private requireSession(sessionId: string): AgentSessionRecord {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`session not found: ${sessionId}`)
    }

    return session
  }

  private setAgentSessionIdInternal(session: AgentSessionRecord, agentSessionId: string): void {
    if (session.agentSessionId && session.agentSessionId !== agentSessionId) {
      session.pastAgentSessionIds = Array.from(new Set([...session.pastAgentSessionIds, session.agentSessionId]))
    }
    session.agentSessionId = agentSessionId
    session.updatedAt = nowIso(this.now)
  }

  private loadSnapshot(snapshot: SessionsSnapshot): void {
    this.sessions = new Map(Object.entries(snapshot.sessions).map(([key, value]) => [key, cloneSession(value)]))
    this.activeSession = new Map(Object.entries(snapshot.activeSession))
    this.userSessions = new Map(Object.entries(snapshot.userSessions).map(([key, value]) => [key, [...value]]))
    this.userMeta = new Map(Object.entries(snapshot.userMeta ?? {}))
    this.counter = snapshot.counter
  }
}

export function parseSessionKey(key: string): { platform: string; groupUser: string } {
  const separatorIndex = key.indexOf(":")
  return separatorIndex >= 0
    ? { platform: key.slice(0, separatorIndex), groupUser: key.slice(separatorIndex + 1) }
    : { platform: key, groupUser: "" }
}

export function flattenSessionSnapshots(projectSnapshots: Record<string, SessionsSnapshot>): FlattenedSessionRecord[] {
  const records: FlattenedSessionRecord[] = []

  for (const [project, snapshot] of Object.entries(projectSnapshots)) {
    const sessionToUserKey = new Map<string, string>()
    for (const [userKey, sessionIds] of Object.entries(snapshot.userSessions)) {
      for (const sessionId of sessionIds) {
        if (!sessionToUserKey.has(sessionId)) {
          sessionToUserKey.set(sessionId, userKey)
        }
      }
    }

    for (const session of Object.values(snapshot.sessions)) {
      const userKey = sessionToUserKey.get(session.id)
      const parsed = userKey ? parseSessionKey(userKey) : { platform: "", groupUser: "" }
      const meta = userKey ? snapshot.userMeta?.[userKey] : undefined

      records.push({
        project,
        sessionId: session.id,
        globalId: `${project}:${session.id}`,
        name: session.name,
        platform: parsed.platform,
        groupUser: parsed.groupUser,
        userName: meta?.userName ?? "",
        chatName: meta?.chatName ?? "",
        messages: session.history.length,
        lastActive: session.updatedAt,
        history: session.history.map((entry) => ({ ...entry })),
      })
    }
  }

  return records.sort((left, right) => right.lastActive.localeCompare(left.lastActive))
}

export function matchesProjectSessionFile(filename: string, project: string): boolean {
  if (!filename.endsWith(".json")) {
    return false
  }

  const base = filename.slice(0, -".json".length)
  if (base === project) {
    return true
  }
  if (base.endsWith(".sessions") && base.slice(0, -".sessions".length) === project) {
    return true
  }
  if (!base.startsWith(`${project}_`)) {
    return false
  }

  const suffix = base.slice(project.length + 1).replace(/^ws_/, "")
  return /^[0-9a-fA-F]+$/.test(suffix)
}

export function findAgentSessionIdFromSnapshots(
  projectSnapshots: Record<string, SessionsSnapshot>,
  project: string,
  sessionKey: string,
): string {
  const snapshot = projectSnapshots[project]
  const activeId = snapshot?.activeSession[sessionKey]
  if (!snapshot || !activeId) {
    throw new Error(`no session found for project ${JSON.stringify(project)} with key ${JSON.stringify(sessionKey)}`)
  }

  const session = snapshot.sessions[activeId]
  if (!session) {
    throw new Error(`session ${JSON.stringify(activeId)} referenced by key ${JSON.stringify(sessionKey)} not found`)
  }
  if (!session.agentSessionId) {
    throw new Error("agent session ID not yet available")
  }

  return session.agentSessionId
}
