import {
  OPEN_AGENT_SESSION_EVENT,
  type OpenAgentSessionPayload,
} from "@/types/agent-navigation"

const OPEN_SETTINGS_TAB_EVENT = "synapse:open-settings-tab"
const OPEN_SETTINGS_ACCOUNT_EVENT = "synapse:open-settings-account"
const OPEN_SETTINGS_ABOUT_EVENT = "synapse:open-settings-about"
const OPEN_SETTINGS_STORAGE_EVENT = "synapse:open-settings-storage"
const APP_TAB_CHANGED_EVENT = "synapse:app-tab-changed"
const WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:watch-next-agent-session"
const CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:cancel-watch-next-agent-session"

type WatchNextAgentSessionPayload = {
  projectId: string
  platform?: string
  sessionKeyPrefix?: string
}
type RequestedSettingsCategory = "account" | "repositories" | "about"
let currentAppId = "agent"
let requestedSettingsCategory: RequestedSettingsCategory | null = null

function requestOpenSettingsTab(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_TAB_EVENT))
}

function publishActiveAppTab(appId: string): void {
  currentAppId = appId
  window.dispatchEvent(new CustomEvent(APP_TAB_CHANGED_EVENT, {
    detail: appId,
  }))
}

function readCurrentAppTab(): string {
  return currentAppId
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
  requestedSettingsCategory = "about"
  requestOpenSettingsTab()
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
  requestedSettingsCategory = "repositories"
  requestOpenSettingsTab()
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

function requestOpenSettingsAccount(): void {
  requestedSettingsCategory = "account"
  requestOpenSettingsTab()
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_ACCOUNT_EVENT))
}

function subscribeOpenSettingsAccount(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_ACCOUNT_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_ACCOUNT_EVENT, handleEvent)
  }
}

function consumeRequestedSettingsCategory(): RequestedSettingsCategory | null {
  const category = requestedSettingsCategory
  requestedSettingsCategory = null
  return category
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
  consumeRequestedSettingsCategory,
  requestOpenAgentSession,
  requestOpenSettingsAccount,
  requestOpenSettingsAbout,
  requestOpenSettingsStorage,
  requestOpenSettingsTab,
  requestWatchNextAgentSession,
  subscribeActiveAppTab,
  subscribeCancelWatchNextAgentSession,
  subscribeOpenAgentSession,
  subscribeOpenSettingsAccount,
  subscribeOpenSettingsAbout,
  subscribeOpenSettingsStorage,
  subscribeOpenSettingsTab,
  subscribeWatchNextAgentSession,
}

export type { OpenAgentSessionPayload, WatchNextAgentSessionPayload }
