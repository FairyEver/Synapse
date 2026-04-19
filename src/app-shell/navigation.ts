const OPEN_SETTINGS_TAB_EVENT = "synapse:open-settings-tab"
const APP_TAB_CHANGED_EVENT = "synapse:app-tab-changed"
let currentAppTab = "rule"

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

export {
  publishActiveAppTab,
  readCurrentAppTab,
  requestOpenSettingsTab,
  subscribeActiveAppTab,
  subscribeOpenSettingsTab,
}
