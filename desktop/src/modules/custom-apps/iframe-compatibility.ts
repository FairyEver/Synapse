const CUSTOM_APP_IFRAME_BASE_SANDBOX = [
  "allow-forms",
  "allow-modals",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-scripts",
  "allow-storage-access-by-user-activation",
]

export const CUSTOM_APP_IFRAME_ALLOW = [
  "accelerometer *",
  "autoplay *",
  "clipboard-write *",
  "encrypted-media *",
  "fullscreen *",
  "gamepad *",
  "gyroscope *",
  "identity-credentials-get *",
  "magnetometer *",
  "picture-in-picture *",
  "publickey-credentials-create *",
  "publickey-credentials-get *",
  "screen-wake-lock *",
  "storage-access *",
  "top-level-storage-access *",
  "web-share *",
  "attribution-reporting 'none'",
  "browsing-topics 'none'",
  "camera 'none'",
  "clipboard-read 'none'",
  "display-capture 'none'",
  "geolocation 'none'",
  "hid 'none'",
  "idle-detection 'none'",
  "local-fonts 'none'",
  "microphone 'none'",
  "midi 'none'",
  "payment 'none'",
  "serial 'none'",
  "speaker-selection 'none'",
  "usb 'none'",
  "window-management 'none'",
].join("; ")

export function customAppIframeSandbox(startUrl: string, parentUrl: string): string {
  const flags = [...CUSTOM_APP_IFRAME_BASE_SANDBOX]
  if (isCrossOrigin(startUrl, parentUrl)) flags.push("allow-same-origin")
  return flags.sort().join(" ")
}

function isCrossOrigin(startUrl: string, parentUrl: string): boolean {
  try {
    return new URL(startUrl).origin !== new URL(parentUrl).origin
  } catch {
    return false
  }
}
