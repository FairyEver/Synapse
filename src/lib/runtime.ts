type SynapseRuntime = {
  platform: string
  versions: {
    chrome: string
    electron: string
    node: string
  }
}

const previewRuntime: SynapseRuntime = {
  platform: "浏览器预览",
  versions: {
    chrome: "预览环境",
    electron: "不可用",
    node: "不可用",
  },
}

export function getSynapseRuntime(): SynapseRuntime {
  return window.synapse ?? previewRuntime
}
