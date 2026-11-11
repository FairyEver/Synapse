export const TUNNEL_SERVICE_ID = "app.tunnel.runtime"
export const TUNNEL_ACTIONS = ["list", "get", "create", "update", "set_enabled", "delete"] as const
export const TUNNEL_CAPABILITY_IDS = TUNNEL_ACTIONS.map(action => `app.tunnel.mapping.${action}` as const)
