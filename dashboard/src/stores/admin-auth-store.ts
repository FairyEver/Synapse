import { create } from 'zustand'
import type { AdminSession } from '@/lib/api'

interface AdminAuthState {
  auth: {
    session: AdminSession | null
    isAuthenticated: boolean
    setSession: (session: AdminSession | null) => void
    reset: () => void
  }
}

export const useAdminAuthStore = create<AdminAuthState>()((set) => ({
  auth: {
    session: null,
    isAuthenticated: false,
    setSession: (session) =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, session, isAuthenticated: Boolean(session) },
      })),
    reset: () =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, session: null, isAuthenticated: false },
      })),
  },
}))
