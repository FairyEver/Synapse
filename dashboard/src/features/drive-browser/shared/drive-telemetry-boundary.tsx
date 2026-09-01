import { useEffect, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { trackDriveEvent, type DriveTelemetryAction } from './drive-telemetry'

export type DriveTelemetryScope = 'console' | 'owner' | 'share'

export function DriveTelemetryBoundary({
  scope,
  children,
}: {
  readonly scope: DriveTelemetryScope
  readonly children: ReactNode
}) {
  useEffect(() => {
    trackDriveEvent({
      eventKey: `web.drive.page.${scope}.open`,
      component: 'drive-page',
      action: 'open',
      category: 'lifecycle',
    })
    return () => {
      trackDriveEvent({
        eventKey: `web.drive.page.${scope}.close`,
        component: 'drive-page',
        action: 'close',
        category: 'lifecycle',
      })
    }
  }, [scope])

  useEffect(() => {
    const portalSelector = '[data-drive-telemetry-scope="portal"]'
    const interactiveSelector = '[data-drive-telemetry-event],button,input,textarea,select,form,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"]'
    const actions: ReadonlyArray<readonly [keyof DocumentEventMap, DriveTelemetryAction]> = [
      ['change', 'change'],
      ['click', 'click'],
      ['dblclick', 'click'],
      ['drop', 'drop'],
      ['focusin', 'focus'],
      ['focusout', 'blur'],
      ['scroll', 'scroll'],
      ['submit', 'submit'],
    ]
    const listeners = actions.map(([eventName, action]) => {
      const listener = (event: Event) => {
        try {
          const source = event.target instanceof Element ? event.target : null
          if (!source?.closest(portalSelector)) return
          const target = source.closest<HTMLElement>(interactiveSelector)
          if (!target) return
          const eventKey = stableEventKey(target.dataset.driveTelemetryEvent) ?? `web.drive.ui.${action}`
          trackDriveEvent({ eventKey, component: 'drive-web', action })
        } catch {
          return
        }
      }
      document.addEventListener(eventName, listener, true)
      return [eventName, listener] as const
    })
    const keyboardListener = (event: globalThis.KeyboardEvent) => {
      if (!['Enter', 'Escape', ' '].includes(event.key)) return
      try {
        const source = event.target instanceof Element ? event.target : null
        if (!source?.closest(portalSelector)) return
        const target = source.closest<HTMLElement>(interactiveSelector)
        if (!target) return
        const eventKey = stableEventKey(target.dataset.driveTelemetryEvent) ?? 'web.drive.ui.select'
        trackDriveEvent({ eventKey, component: 'drive-web', action: 'select' })
      } catch {
        return
      }
    }
    document.addEventListener('keydown', keyboardListener, true)
    return () => {
      for (const [eventName, listener] of listeners) document.removeEventListener(eventName, listener, true)
      document.removeEventListener('keydown', keyboardListener, true)
    }
  }, [])

  const capture = (action: DriveTelemetryAction) => (event: SyntheticEvent<HTMLElement>) => {
    try {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-drive-telemetry-event],button,input,textarea,select,form,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"]')
        : null
      const eventKey = stableEventKey(target?.dataset.driveTelemetryEvent) ?? `web.drive.ui.${action}`
      trackDriveEvent({ eventKey, component: 'drive-web', action })
    } catch {
      return
    }
  }

  const captureKeyboardAction = (event: KeyboardEvent<HTMLElement>) => {
    if (!['Enter', 'Escape', ' '].includes(event.key)) return
    capture('select')(event)
  }

  return (
    <div
      className='contents'
      data-drive-telemetry-scope={scope}
      onBlurCapture={capture('blur')}
      onChangeCapture={capture('change')}
      onClickCapture={capture('click')}
      onDoubleClickCapture={capture('click')}
      onDropCapture={capture('drop')}
      onFocusCapture={capture('focus')}
      onKeyDownCapture={captureKeyboardAction}
      onScrollCapture={capture('scroll')}
      onSubmitCapture={capture('submit')}
    >
      {children}
    </div>
  )
}

function stableEventKey(value: string | undefined): string | null {
  return value && /^[a-z][a-z0-9._-]{0,63}$/u.test(value) ? value : null
}
