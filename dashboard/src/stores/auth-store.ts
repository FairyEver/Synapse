import { create } from 'zustand'

export interface AuthUser {
  email: string
  handle: string | null
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
    setUser: (user) =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, user, isAuthenticated: !!user },
      })),
    reset: () =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, user: null, isAuthenticated: false },
      })),
  },
}))
