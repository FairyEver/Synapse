import type { CheatCodeRegistration as BaseCheatCodeRegistration } from "@/types/cheat-code"

export const SETTINGS_CHEAT_CODE_TITLE = "Synapse AI Studio"
export const CHEAT_CODE_INTERACTION_RESET_DELAY = 10000
export const CHEAT_CODE_LOGO_CLICK_THRESHOLD = 10

export const SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES = [
  "text-red-500",
  "text-orange-500",
  "text-yellow-500",
  "text-green-500",
  "text-blue-500",
  "text-indigo-500",
  "text-violet-500",
] as const

export type SettingsTitlePart = {
  readonly index: number
  readonly char: string
  readonly clickable: boolean
}

export type CheatCodeContext = {
  readonly enableRepositoryMaintenance: () => void
}

export type SettingsTitleSequenceBinding = {
  readonly settingsTitleSequence: readonly number[]
}

export type CheatCodeRegistration = BaseCheatCodeRegistration<SettingsTitleSequenceBinding, CheatCodeContext>

export function buildSettingsTitleParts(title: string = SETTINGS_CHEAT_CODE_TITLE): readonly SettingsTitlePart[] {
  return Array.from(title, (char, index) => ({
    index,
    char,
    clickable: char !== " ",
  }))
}

export function getSettingsTitleActiveColorClass(index: number, offset = 0): string {
  const classIndex = positiveModulo(index - offset, SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.length)
  return SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[classIndex] ?? "text-foreground"
}

export const settingsTitleParts = buildSettingsTitleParts()

const registeredCheatCodes = [
  {
    definition: {
      name: "settings:repository-maintenance:enable",
      kind: "action",
      run: ({ enableRepositoryMaintenance }) => {
        enableRepositoryMaintenance()
      },
    },
    binding: {
      settingsTitleSequence: [0, 11, 8, 9],
    },
  },
] satisfies readonly CheatCodeRegistration[]

export const settingsCheatCodes = validateCheatCodeRegistrations(registeredCheatCodes)

export function validateCheatCodeRegistrations(
  registrations: readonly CheatCodeRegistration[],
  titleParts: readonly SettingsTitlePart[] = settingsTitleParts,
): readonly CheatCodeRegistration[] {
  const titlePartByIndex = new Map(titleParts.map((part) => [part.index, part]))
  const names = new Set<string>()
  const sequences = new Map<string, string>()

  for (const registration of registrations) {
    const name = registration.definition.name.trim()

    if (!name) {
      throw new Error("Cheat code name is required.")
    }

    if (names.has(name)) {
      throw new Error(`Duplicate cheat code name: ${name}`)
    }

    names.add(name)

    if (registration.binding.settingsTitleSequence.length === 0) {
      throw new Error(`Cheat code settingsTitleSequence is required for ${name}.`)
    }

    for (const index of registration.binding.settingsTitleSequence) {
      if (!Number.isInteger(index)) {
        throw new Error(`Title sequence index ${index} is not an integer.`)
      }

      const titlePart = titlePartByIndex.get(index)

      if (!titlePart) {
        throw new Error(`Title sequence index ${index} is outside the title.`)
      }

      if (!titlePart.clickable) {
        throw new Error(`Title sequence index ${index} is not clickable.`)
      }
    }

    const sequenceKey = registration.binding.settingsTitleSequence.join(",")
    const existingName = sequences.get(sequenceKey)

    if (existingName) {
      throw new Error(`Duplicate title sequence: ${sequenceKey}`)
    }

    sequences.set(sequenceKey, name)
  }

  for (let leftIndex = 0; leftIndex < registrations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < registrations.length; rightIndex += 1) {
      const left = registrations[leftIndex]
      const right = registrations[rightIndex]

      if (!left || !right) {
        continue
      }

      if (
        isPrefixSequence(left.binding.settingsTitleSequence, right.binding.settingsTitleSequence)
        || isPrefixSequence(right.binding.settingsTitleSequence, left.binding.settingsTitleSequence)
      ) {
        throw new Error(`Title sequence prefix conflict: ${left.definition.name} and ${right.definition.name}`)
      }
    }
  }

  return registrations
}

function isPrefixSequence(left: readonly number[], right: readonly number[]): boolean {
  if (left.length >= right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo
}
