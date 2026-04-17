export const SYNAPSE_IPC_CHANNELS = {
  config: {
    get: "synapse:config:get",
    update: "synapse:config:update",
  },
  repository: {
    chooseDirectory: "synapse:repository:choose-directory",
    getStates: "synapse:repository:get-states",
    sync: "synapse:repository:sync",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
  },
} as const
