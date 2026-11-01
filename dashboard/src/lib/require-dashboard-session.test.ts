import { afterEach, describe, expect, it } from 'vitest'
import { requireDashboardSession } from './require-dashboard-session'
import { useAuthStore } from '@/stores/auth-store'

afterEach(() => useAuthStore.getState().auth.reset())
describe('standalone session handoff', () => {
  it('uses the canonical login entry and preserves the document and comment target', () => {
    let destination: unknown
    try { requireDashboardSession({ pathname: '/drive/items/document', search: '?surface=standalone&threadId=thread', hash: '#comment' }) } catch (error) { destination = error }
    expect(destination).toMatchObject({ options: { href: '/console/sign-in?redirect=%2Fdrive%2Fitems%2Fdocument%3Fsurface%3Dstandalone%26threadId%3Dthread%23comment', reloadDocument: true } })
  })
})
