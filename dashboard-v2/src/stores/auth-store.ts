import { broadcastUserSessionChange } from '@/lib/user-session-events'
import { create } from 'zustand'

export interface AuthUser {
  email: string
  handle: string | null
  nickname?: string
  avatarUrl?: string | null
  sessionId: string
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    isAuthenticated: boolean
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    isAuthenticated: false,
    setUser: (user) => {
      broadcastUserSessionChange()
      set((state) => ({
        ...state,
        auth: { ...state.auth, user, isAuthenticated: !!user },
      }))
    },
    reset: () => {
      broadcastUserSessionChange()
      set((state) => ({
        ...state,
        auth: { ...state.auth, user: null, isAuthenticated: false },
      }))
    },
  },
}))
