export const SYNAPSE_IPC_CHANNELS = {
  config: {
    get: "synapse:config:get",
    update: "synapse:config:update",
  },
  repository: {
    getStates: "synapse:repository:get-states",
    clone: "synapse:repository:clone",
    sync: "synapse:repository:sync",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
  },
} as const
