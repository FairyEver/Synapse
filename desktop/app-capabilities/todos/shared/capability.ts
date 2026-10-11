export const TODOS_SERVICE_ID = "app.todos.cloud"
export const TODOS_ACTIONS = ["list", "get", "create", "update", "set_completed", "delete"] as const
export const TODOS_CAPABILITY_IDS = TODOS_ACTIONS.map((action) => `app.todos.item.${action}` as const)
