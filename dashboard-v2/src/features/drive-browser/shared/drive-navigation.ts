import type { MouseEvent } from 'react'

export type DriveBrowserNavigate = (browserUrl: string) => void

export function navigateDriveBrowserUrl(browserUrl: string) {
  window.history.pushState(null, '', browserUrl)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function shouldHandleDriveBrowserLinkClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    event.currentTarget.target !== '_blank'
  )
}
