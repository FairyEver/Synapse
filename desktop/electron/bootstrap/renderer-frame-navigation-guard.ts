export function shouldBlockRendererSubframeNavigation(input: {
  readonly url: string
  readonly mainFrameUrl: string
  readonly isMainFrame: boolean
}): boolean {
  if (input.isMainFrame) return false
  try {
    return new URL(input.url).origin === new URL(input.mainFrameUrl).origin
  } catch {
    return false
  }
}
