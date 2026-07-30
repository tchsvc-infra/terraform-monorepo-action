export function stripComments(content: string): string {
  let out = ''
  let i = 0
  let inString: '"' | "'" | null = null
  let inHeredoc: string | null = null

  while (i < content.length) {
    const ch = content[i]
    const next = content[i + 1]

    if (inHeredoc !== null) {
      out += ch
      if (ch === '\n') {
        const rest = content.slice(i + 1)
        const line = rest.slice(
          0,
          rest.indexOf('\n') === -1 ? undefined : rest.indexOf('\n'),
        )
        if (line.trim() === inHeredoc) {
          inHeredoc = null
        }
      }
      i += 1
      continue
    }

    if (inString !== null) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === inString) inString = null
      i += 1
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = ch
      out += ch
      i += 1
      continue
    }

    // Heredoc start: <<EOF or <<-EOF
    if (ch === '<' && next === '<') {
      const match = /^<<-?([A-Za-z_][A-Za-z0-9_-]*)/.exec(content.slice(i))
      if (match) {
        inHeredoc = match[1] ?? null
        out += match[0]
        i += match[0].length
        continue
      }
    }

    if (ch === '#' || (ch === '/' && next === '/')) {
      while (i < content.length && content[i] !== '\n') i += 1
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (
        i < content.length &&
        !(content[i] === '*' && content[i + 1] === '/')
      )
        i += 1
      i += 2
      continue
    }

    out += ch
    i += 1
  }

  return out
}

/**
 * Extract the bodies of all top-level blocks with the given type,
 * e.g. `terraform { ... }` or `module "name" { ... }`.
 * Returns one entry per block: its labels and raw body.
 */
export function extractBlocks(
  content: string,
  type: string,
): Array<{ labels: string[]; body: string }> {
  const stripped = stripComments(content)
  const blocks: Array<{ labels: string[]; body: string }> = []
  const headerRe = new RegExp(
    `(^|\\n)[ \\t]*${type}((?:[ \\t]+"[^"]*")*)[ \\t]*\\{`,
    'g',
  )

  let match: RegExpExecArray | null
  while ((match = headerRe.exec(stripped)) !== null) {
    const labels = [...(match[2] ?? '').matchAll(/"([^"]*)"/g)].map(
      (m) => m[1] ?? '',
    )
    const bodyStart = match.index + match[0].length
    let depth = 1
    let j = bodyStart
    let inString = false
    while (j < stripped.length && depth > 0) {
      const ch = stripped[j]
      if (inString) {
        if (ch === '\\') j += 1
        else if (ch === '"') inString = false
      } else if (ch === '"') {
        inString = true
      } else if (ch === '{') {
        depth += 1
      } else if (ch === '}') {
        depth -= 1
      }
      j += 1
    }
    blocks.push({ labels, body: stripped.slice(bodyStart, j - 1) })
    headerRe.lastIndex = j
  }

  return blocks
}

export interface TerraformBlockFeatures {
  hasBackend: boolean
  hasCloud: boolean
  hasEncryption: boolean
}

/** Inspect all `terraform { ... }` blocks for root-module markers. */
export function terraformBlockFeatures(
  content: string,
): TerraformBlockFeatures {
  const features: TerraformBlockFeatures = {
    hasBackend: false,
    hasCloud: false,
    hasEncryption: false,
  }
  for (const block of extractBlocks(content, 'terraform')) {
    if (/(^|\n)[ \t]*backend[ \t]+"[^"]+"[ \t]*\{/.test(block.body))
      features.hasBackend = true
    if (/(^|\n)[ \t]*cloud[ \t]*\{/.test(block.body)) features.hasCloud = true
    if (/(^|\n)[ \t]*encryption[ \t]*\{/.test(block.body))
      features.hasEncryption = true
  }
  return features
}

export function hasProviderConfiguration(content: string): boolean {
  return extractBlocks(content, 'provider').some(
    (b) => b.body.trim().length > 0,
  )
}

/** Extract the `source` argument of every `module "name" { ... }` block. */
export function extractModuleSources(content: string): string[] {
  const sources: string[] = []
  for (const block of extractBlocks(content, 'module')) {
    const match = /(^|\n)[ \t]*source[ \t]*=[ \t]*"([^"]+)"/.exec(block.body)
    if (match?.[2]) sources.push(match[2])
  }
  return sources
}
