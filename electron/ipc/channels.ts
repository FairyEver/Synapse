export const SYNAPSE_IPC_CHANNELS = {
  config: {
    get: "synapse:config:get",
    update: "synapse:config:update",
  },
  log: {
    appended: "synapse:log:appended",
    export: "synapse:log:export",
    list: "synapse:log:list",
    summary: "synapse:log:summary",
    write: "synapse:log:write",
  },
  repository: {
    chooseDirectory: "synapse:repository:choose-directory",
    getStates: "synapse:repository:get-states",
    sync: "synapse:repository:sync",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
  },
} as const
