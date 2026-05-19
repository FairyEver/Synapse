/** Height of the switch card header section (icon + name + agent info + prompt hint). */
export const SWITCH_HEADER_H = 88

export const SWITCH_NODE_ID_H = 28

/** Height of each branch row inside the switch card. */
export const SWITCH_BRANCH_H = 28

export function getSwitchHeaderHeight(showNodeId: boolean): number {
  return SWITCH_HEADER_H + (showNodeId ? SWITCH_NODE_ID_H : 0)
}
