import type { EditorScanSkillItem } from "@/types/editor-scan"

function prioritizeSynapseSkills(
  skills: readonly EditorScanSkillItem[],
): EditorScanSkillItem[] {
  return [
    ...skills.filter((skill) => skill.source === "synapse"),
    ...skills.filter((skill) => skill.source !== "synapse"),
  ]
}

export { prioritizeSynapseSkills }
