import type { BuiltinCapabilityPackageManifestV1 } from "../../manifest"
import {
  JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
  JAVASCRIPT_RUN_CAPABILITY_ID,
  JAVASCRIPT_RUN_CAPABILITY_VERSION,
  JAVASCRIPT_RUN_PACKAGE_ID,
  JAVASCRIPT_RUN_PACKAGE_VERSION,
  JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
} from "../../script-runtime/shared/capability"

export const javascriptRunPackageManifest = {
  schemaVersion: 1,
  packageId: JAVASCRIPT_RUN_PACKAGE_ID,
  packageVersion: JAVASCRIPT_RUN_PACKAGE_VERSION,
  capabilities: [{
    id: JAVASCRIPT_RUN_CAPABILITY_ID,
    version: JAVASCRIPT_RUN_CAPABILITY_VERSION,
    availability: "always",
    userToggle: "none",
  }],
  workflowNodes: [{
    type: JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
    capabilityId: JAVASCRIPT_RUN_CAPABILITY_ID,
    discovery: "visible",
  }],
  automationActions: [{
    type: JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
    capabilityId: JAVASCRIPT_RUN_CAPABILITY_ID,
    discovery: "visible",
  }],
  mcpTools: [],
  systemApp: null,
  deepLinks: [],
} as const satisfies BuiltinCapabilityPackageManifestV1
