declare global {
  interface Window {
    synapse?: {
      platform: string
      versions: {
        chrome: string
        electron: string
        node: string
      }
    }
  }
}

export {}
