const OPEN_SETTINGS_TAB_EVENT = "synapse:open-settings-tab"
const OPEN_SETTINGS_ABOUT_EVENT = "synapse:open-settings-about"
const OPEN_SETTINGS_STORAGE_EVENT = "synapse:open-settings-storage"
const APP_TAB_CHANGED_EVENT = "synapse:app-tab-changed"
const OPEN_AGENT_SESSION_EVENT = "synapse:open-agent-session"
const WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:watch-next-agent-session"
const CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:cancel-watch-next-agent-session"

type OpenAgentSessionPayload = {
  projectId: string
  conversationId: string
  prompt?: string
}

type WatchNextAgentSessionPayload = {
  projectId: string
  platform?: string
  sessionKeyPrefix?: string
}
let currentAppTab = "skill"

function requestOpenSettingsTab(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_TAB_EVENT))
}

function publishActiveAppTab(tabId: string): void {
  currentAppTab = tabId
  window.dispatchEvent(new CustomEvent(APP_TAB_CHANGED_EVENT, {
    detail: tabId,
  }))
}

function readCurrentAppTab(): string {
  return currentAppTab
}

function subscribeOpenSettingsTab(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_TAB_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_TAB_EVENT, handleEvent)
  }
}

function subscribeActiveAppTab(listener: (tabId: string) => void): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<string>).detail)
  }

  window.addEventListener(APP_TAB_CHANGED_EVENT, handleEvent)

  return () => {
    window.removeEventListener(APP_TAB_CHANGED_EVENT, handleEvent)
  }
}

function requestOpenSettingsAbout(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_ABOUT_EVENT))
}

function subscribeOpenSettingsAbout(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_ABOUT_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_ABOUT_EVENT, handleEvent)
  }
}

function requestOpenSettingsStorage(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_STORAGE_EVENT))
}

function subscribeOpenSettingsStorage(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_STORAGE_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_STORAGE_EVENT, handleEvent)
  }
}

function requestWatchNextAgentSession(payload: WatchNextAgentSessionPayload): void {
  window.dispatchEvent(new CustomEvent(WATCH_NEXT_AGENT_SESSION_EVENT, { detail: payload }))
}

function cancelWatchNextAgentSession(payload: WatchNextAgentSessionPayload): void {
  window.dispatchEvent(new CustomEvent(CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT, { detail: payload }))
}

function subscribeWatchNextAgentSession(
  listener: (payload: WatchNextAgentSessionPayload) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<WatchNextAgentSessionPayload>).detail)
  }

  window.addEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)

  return () => {
    window.removeEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)
  }
}

function subscribeCancelWatchNextAgentSession(
  listener: (payload: WatchNextAgentSessionPayload) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<WatchNextAgentSessionPayload>).detail)
  }

  window.addEventListener(CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)

  return () => {
    window.removeEventListener(CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)
  }
}

function requestOpenAgentSession(payload: OpenAgentSessionPayload): void {
  window.dispatchEvent(new CustomEvent(OPEN_AGENT_SESSION_EVENT, { detail: payload }))
}

function subscribeOpenAgentSession(
  listener: (payload: OpenAgentSessionPayload) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<OpenAgentSessionPayload>).detail)
  }

  window.addEventListener(OPEN_AGENT_SESSION_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_AGENT_SESSION_EVENT, handleEvent)
  }
}

export {
  cancelWatchNextAgentSession,
  publishActiveAppTab,
  readCurrentAppTab,
  requestOpenAgentSession,
  requestOpenSettingsAbout,
  requestOpenSettingsStorage,
  requestOpenSettingsTab,
  requestWatchNextAgentSession,
  subscribeActiveAppTab,
  subscribeCancelWatchNextAgentSession,
  subscribeOpenAgentSession,
  subscribeOpenSettingsAbout,
  subscribeOpenSettingsStorage,
  subscribeOpenSettingsTab,
  subscribeWatchNextAgentSession,
}

export type { OpenAgentSessionPayload, WatchNextAgentSessionPayload }
