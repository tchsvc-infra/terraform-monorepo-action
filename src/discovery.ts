import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import picomatch from 'picomatch'

/** File name patterns that make a directory a Terraform/OpenTofu module. */
const CONFIG_FILE_RE = /\.(tf|tofu)(\.json)?$/

/** Test files never count as module content. */
const TEST_FILE_RE = /\.(tftest|tofutest)\.(hcl|json)$/

const SKIP_DIR_NAMES = new Set(['.git', '.terraform', 'node_modules'])

export const DEFAULT_EXCLUDES = ['.github/**', '.github']

export function isModuleConfigFile(name: string): boolean {
  return CONFIG_FILE_RE.test(name) && !TEST_FILE_RE.test(name)
}

/**
 * Expand glob patterns so that `foo/**` also matches the directory `foo`
 * itself, making include/exclude behave intuitively for directory scoping.
 */
function expandDirPatterns(patterns: string[]): string[] {
  const expanded = new Set<string>()
  for (const pattern of patterns) {
    expanded.add(pattern)
    if (pattern.endsWith('/**')) expanded.add(pattern.slice(0, -3))
  }
  return [...expanded]
}

export interface DiscoveryOptions {
  include?: string[]
  exclude?: string[]
}

export function discoverModules(
  rootDir: string,
  options: DiscoveryOptions = {},
): string[] {
  const include = expandDirPatterns(options.include ?? [])
  const exclude = expandDirPatterns([
    ...DEFAULT_EXCLUDES,
    ...(options.exclude ?? []),
  ])

  const isIncluded =
    include.length > 0 ? picomatch(include, { dot: true }) : () => true
  const isExcluded = picomatch(exclude, { dot: true })

  const modules: string[] = []

  const walk = (relDir: string): void => {
    const absDir = relDir === '' ? rootDir : join(rootDir, relDir)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }

    const relPath = relDir === '' ? '.' : relDir
    if (relDir !== '' && isExcluded(relPath)) return

    const hasConfig = entries.some(
      (e) => e.isFile() && isModuleConfigFile(e.name),
    )
    if (hasConfig && isIncluded(relPath)) {
      modules.push(relPath)
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name)) continue
      walk(relDir === '' ? entry.name : `${relDir}/${entry.name}`)
    }
  }

  walk('')
  return modules.sort()
}

/**
 * Collect every file in the repository (repo-relative POSIX paths), skipping
 * the same internal directories as module discovery.
 */
export function collectFiles(rootDir: string): string[] {
  const files: string[] = []

  const walk = (relDir: string): void => {
    const absDir = relDir === '' ? rootDir : join(rootDir, relDir)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isFile()) files.push(relPath)
      else if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name))
        walk(relPath)
    }
  }

  walk('')
  return files.sort()
}
