import {
  driveAnnotationApi,
  driveApi,
  driveBrowserApi,
  driveFileVersionsApi,
} from '@/lib/api'
import { startDriveOperation } from './drive-telemetry'

export const trackedDriveApi = trackApi(driveApi, 'items')
export const trackedDriveBrowserApi = trackApi(driveBrowserApi, 'browser')
export const trackedDriveAnnotationApi = trackApi(driveAnnotationApi, 'annotations')
export const trackedDriveFileVersionsApi = trackApi(driveFileVersionsApi, 'versions')

function trackApi<Api extends Record<string, unknown>>(api: Api, namespace: string): Api {
  if (!api) return api
  const wrappers = new Map<PropertyKey, unknown>()
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const existing = wrappers.get(property)
      if (existing) return existing
      const wrapped = (...args: unknown[]) => {
        const eventKey = `web.drive.operation.${namespace}.${toStableOperationName(String(property))}`
        const finish = startDriveOperation(eventKey)
        let result: unknown
        try {
          result = Reflect.apply(Reflect.get(target, property, receiver) as (...values: unknown[]) => unknown, target, args)
        } catch (error) {
          finish('failure')
          throw error
        }
        if (!isPromiseLike(result)) return result
        return result.then(
          (resolved) => {
            finish('success')
            return resolved
          },
          (error) => {
            finish('failure')
            throw error
          },
        )
      }
      wrappers.set(property, wrapped)
      return wrapped
    },
  })
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}

function toStableOperationName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()
}
