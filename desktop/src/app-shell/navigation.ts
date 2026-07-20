import {
  OPEN_AGENT_SESSION_EVENT,
  type OpenAgentSessionPayload,
} from "@/types/agent-navigation"

const OPEN_SETTINGS_TAB_EVENT = "synapse:app:open_settings_tab:operation"
const OPEN_SETTINGS_ACCOUNT_EVENT = "synapse:app:open_settings_account:operation"
const OPEN_SETTINGS_ABOUT_EVENT = "synapse:app:open_settings_about:operation"
const OPEN_SETTINGS_DOCK_EVENT = "synapse:app:open_settings_dock:operation"
const OPEN_SETTINGS_STORAGE_EVENT = "synapse:app:open_settings_storage:operation"
const APP_TAB_CHANGED_EVENT = "synapse:app:app_tab_changed:operation"
const WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:app:watch_next_agent_session:operation"
const CANCEL_WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:app:cancel_watch_next_agent_session:operation"

type WatchNextAgentSessionPayload = {
  projectId: string
  platform?: string
  sessionKeyPrefix?: string
}
type RequestedSettingsCategory = "account" | "repositories" | "about" | "dock"
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

function requestOpenSettingsDock(): void {
  requestedSettingsCategory = "dock"
  requestOpenSettingsTab()
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_DOCK_EVENT))
}

function subscribeOpenSettingsDock(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_DOCK_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_DOCK_EVENT, handleEvent)
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
  requestOpenSettingsDock,
  requestOpenSettingsStorage,
  requestOpenSettingsTab,
  requestWatchNextAgentSession,
  subscribeActiveAppTab,
  subscribeCancelWatchNextAgentSession,
  subscribeOpenAgentSession,
  subscribeOpenSettingsAccount,
  subscribeOpenSettingsAbout,
  subscribeOpenSettingsDock,
  subscribeOpenSettingsStorage,
  subscribeOpenSettingsTab,
  subscribeWatchNextAgentSession,
}

export type { OpenAgentSessionPayload, WatchNextAgentSessionPayload }
