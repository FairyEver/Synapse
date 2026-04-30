function getRendererPlatform(): string | undefined {
  return typeof window === "undefined" ? undefined : window.synapse?.platform
}

export { getRendererPlatform }
