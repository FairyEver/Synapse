import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { supportsPokerCardRules } from "@synapse/shared/game-contracts"

async function readAvailability() {
  const guide = await gameApi().poker.guide() as { cards?: { available?: unknown; supportedVersions?: unknown } }
  const cards = guide?.cards, versions = cards?.supportedVersions
  return { available: cards?.available === true && Array.isArray(versions)
    && supportsPokerCardRules(versions.filter(version => typeof version === "string").join(",")) }
}
export function usePokerCardAvailability(identityKey: string | null) {
  const query = useGameQuery(readAvailability, `poker:card-availability:${identityKey}`, 0, !!identityKey)
  return { available: query.data?.available === true, loading: query.loading, error: query.error, reload: query.refresh }
}
