function stripFrontmatter(rawMarkdown) {
  return rawMarkdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')
}

function homepageMarkdown(frontmatter) {
  const hero = frontmatter?.hero
  if (frontmatter?.layout !== 'home' || !hero) return ''

  const heading = [hero.name, hero.text].filter(Boolean).join(' ')
  const lines = heading ? [`# ${heading}`] : []

  if (hero.tagline) lines.push('', hero.tagline)

  const actions = Array.isArray(hero.actions) ? hero.actions : []
  for (const action of actions) {
    if (!action?.text || !action?.link) continue
    lines.push('', `[${action.text}](${action.link})`)
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export function buildCopyMarkdown(rawMarkdown, frontmatter = {}) {
  const body = stripFrontmatter(rawMarkdown)
  if (body.trim()) return body
  return homepageMarkdown(frontmatter)
}
