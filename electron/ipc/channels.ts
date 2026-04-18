export const SYNAPSE_IPC_CHANNELS = {
  content: {
    createRule: "synapse:content:create-rule",
    createSkill: "synapse:content:create-skill",
    getRuleContent: "synapse:content:get-rule-content",
    getRules: "synapse:content:get-rules",
    getSkillContent: "synapse:content:get-skill-content",
    getSkillFiles: "synapse:content:get-skill-files",
    getSkills: "synapse:content:get-skills",
  },
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
