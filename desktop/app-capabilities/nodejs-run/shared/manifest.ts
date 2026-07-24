import type { BuiltinCapabilityPackageManifestV1 } from "../../manifest"
import {
  NODEJS_RUN_AUTOMATION_ACTION_TYPE,
  NODEJS_RUN_CAPABILITY_ID,
  NODEJS_RUN_CAPABILITY_VERSION,
  NODEJS_RUN_PACKAGE_ID,
  NODEJS_RUN_PACKAGE_VERSION,
  NODEJS_RUN_WORKFLOW_NODE_TYPE,
} from "../../script-runtime/shared/capability"

export const nodejsRunPackageManifest = {
  schemaVersion: 1,
  packageId: NODEJS_RUN_PACKAGE_ID,
  packageVersion: NODEJS_RUN_PACKAGE_VERSION,
  capabilities: [{
    id: NODEJS_RUN_CAPABILITY_ID,
    version: NODEJS_RUN_CAPABILITY_VERSION,
    availability: "always",
    userToggle: "none",
  }],
  workflowNodes: [{
    type: NODEJS_RUN_WORKFLOW_NODE_TYPE,
    capabilityId: NODEJS_RUN_CAPABILITY_ID,
    discovery: "visible",
  }],
  automationActions: [{
    type: NODEJS_RUN_AUTOMATION_ACTION_TYPE,
    capabilityId: NODEJS_RUN_CAPABILITY_ID,
    discovery: "visible",
  }],
  mcpTools: [],
  systemApp: null,
  deepLinks: [],
} as const satisfies BuiltinCapabilityPackageManifestV1
