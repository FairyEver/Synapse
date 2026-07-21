import { requestJson } from './api-client'

export type DesktopUpdateIntent = {
  deepLink: string
  expiresAt: string
}

const desktopUpdateIntentPath = '/api/desktop/update-intent'

export const desktopUpdateApi = {
  issueIntent: () => requestJson<DesktopUpdateIntent>(desktopUpdateIntentPath, { method: 'POST' }),
}
