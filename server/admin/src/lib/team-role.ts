export type TeamRole = "owner" | "member"

const teamRoleLabels: Record<TeamRole, string> = {
  owner: "所有者",
  member: "成员",
}

export function formatTeamRole(role: TeamRole): string {
  return teamRoleLabels[role]
}
