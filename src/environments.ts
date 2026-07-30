import picomatch from 'picomatch'

import { normalizePath, owningModule } from './changed.js'

/** Environment name -> glob patterns identifying its env-specific files. */
export type EnvironmentPatterns = Map<string, string[]>

/**
 * Split a glob list on `,` or `;`, ignoring delimiters inside braces so
 * brace-expansion globs like `{dev,develop}.*` stay intact.
 */
function splitGlobs(raw: string): string[] {
  const globs: string[] = []
  let current = ''
  let depth = 0
  for (const ch of raw) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      globs.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  globs.push(current)
  return globs.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Parse the `environments` input: one environment per line in the form
 * `name=glob[,glob...]` (globs delimited by `,` or `;`).
 */
export function parseEnvironments(raw: string): EnvironmentPatterns {
  const patterns: EnvironmentPatterns = new Map()
  for (const line of raw.split('\n')) {
    const entry = line.trim()
    if (!entry) continue
    const eq = entry.indexOf('=')
    const name = eq > 0 ? entry.slice(0, eq).trim() : ''
    const globs = eq > 0 ? splitGlobs(entry.slice(eq + 1)) : []
    if (!name || globs.length === 0) {
      throw new Error(
        `Invalid environments entry: '${entry}' (expected name=glob[,glob...])`,
      )
    }
    patterns.set(name, globs)
  }
  return patterns
}

/**
 * Names of environments whose patterns match the given file.
 * Patterns without a `/` are matched against the file name anywhere in the
 * tree (e.g. `prod.tfvars`); patterns with a `/` match the full repo path.
 */
export function environmentsOfFile(
  file: string,
  patterns: EnvironmentPatterns,
): string[] {
  const normalized = normalizePath(file)
  const result: string[] = []
  for (const [name, globs] of patterns) {
    const matched = globs.some((glob) =>
      picomatch.isMatch(normalized, glob, {
        dot: true,
        basename: !glob.includes('/'),
      }),
    )
    if (matched) result.push(name)
  }
  return result
}

/**
 * Determine which environments each module has: environment E belongs to
 * module M when a file owned by M matches one of E's patterns.
 */
export function moduleEnvironments(
  allFiles: string[],
  moduleDirs: Set<string>,
  patterns: EnvironmentPatterns,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  if (patterns.size === 0) return result
  for (const file of allFiles) {
    const envs = environmentsOfFile(file, patterns)
    if (envs.length === 0) continue
    const owner = owningModule(normalizePath(file), moduleDirs)
    if (owner === undefined) continue
    let set = result.get(owner)
    if (!set) {
      set = new Set()
      result.set(owner, set)
    }
    for (const env of envs) set.add(env)
  }
  return result
}

/** All environments of a module are triggered. */
export const ALL_ENVIRONMENTS = '*'

/**
 * Compute which environments are triggered per directly-changed module.
 * A changed file matching an environment pattern triggers only that
 * environment; any other file triggers all environments of its module.
 */
export function environmentTriggers(
  changedFiles: string[],
  moduleDirs: Set<string>,
  patterns: EnvironmentPatterns,
): Map<string, Set<string> | typeof ALL_ENVIRONMENTS> {
  const triggers = new Map<string, Set<string> | typeof ALL_ENVIRONMENTS>()
  for (const raw of changedFiles) {
    const file = normalizePath(raw)
    const owner = owningModule(file, moduleDirs)
    if (owner === undefined) continue
    const envs = environmentsOfFile(file, patterns)
    const current = triggers.get(owner)
    if (current === ALL_ENVIRONMENTS) continue
    if (envs.length === 0) {
      triggers.set(owner, ALL_ENVIRONMENTS)
    } else {
      const set = current ?? new Set<string>()
      for (const env of envs) set.add(env)
      triggers.set(owner, set)
    }
  }
  return triggers
}

export interface MatrixEntry {
  module: string
  environment?: string
}

/**
 * Build matrix entries for the affected root modules. Modules with known
 * environments fan out into one entry per triggered environment; modules
 * without environments produce a single entry.
 */
export function buildEnvironmentsMatrix(
  rootModules: string[],
  moduleEnvs: Map<string, Set<string>>,
  triggers: Map<string, Set<string> | typeof ALL_ENVIRONMENTS>,
  mode: string,
): MatrixEntry[] {
  const entries: MatrixEntry[] = []
  for (const module of rootModules) {
    const known = [...(moduleEnvs.get(module) ?? [])].sort()
    // Propagated (or mode=all) modules have no direct trigger: all envs.
    const trigger =
      mode === 'all'
        ? ALL_ENVIRONMENTS
        : (triggers.get(module) ?? ALL_ENVIRONMENTS)
    const envs = trigger === ALL_ENVIRONMENTS ? known : [...trigger].sort()
    if (envs.length === 0) {
      entries.push({ module })
    } else {
      for (const env of envs) entries.push({ module, environment: env })
    }
  }
  return entries
}
