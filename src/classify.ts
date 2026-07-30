import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'

import { isModuleConfigFile } from './discovery.js'
import {
  extractModuleSources,
  hasProviderConfiguration,
  terraformBlockFeatures,
} from './hcl.js'
import type { Engine, ModuleAnalysis } from './types.js'

const AUTO_TFVARS_RE = /\.auto\.tfvars(\.json)?$/

const DEFINITIVE_MARKER_FILES: Record<string, string> = {
  'terraform.tfstate': 'terraform.tfstate present',
  '.terraform.lock.hcl': '.terraform.lock.hcl present',
}

const SUPPORTING_MARKER_FILES: Record<string, string> = {
  'terraform.tfvars': 'terraform.tfvars present',
  'terraform.tfvars.json': 'terraform.tfvars.json present',
}

/**
 * Resolve the effective set of configuration files for a module directory,
 * honouring OpenTofu precedence: when `x.tofu` and `x.tf` (or `x.tofu.json`
 * and `x.tf.json`) share a basename, only the `.tofu` variant is loaded.
 */
export function effectiveConfigFiles(fileNames: string[]): string[] {
  const configFiles = fileNames.filter(isModuleConfigFile)
  const tofuBasenames = new Set(
    configFiles
      .filter((f) => /\.tofu(\.json)?$/.test(f))
      .map((f) => f.replace(/\.tofu(\.json)?$/, '')),
  )
  return configFiles.filter((f) => {
    const tfMatch = /^(.*)\.tf(\.json)?$/.exec(f)
    return !(tfMatch && tofuBasenames.has(tfMatch[1] ?? ''))
  })
}

export function analyzeModule(
  rootDir: string,
  modulePath: string,
): ModuleAnalysis {
  const absDir = modulePath === '.' ? rootDir : join(rootDir, modulePath)
  const fileNames = readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)

  const definitiveMarkers: string[] = []
  const supportingMarkers: string[] = []
  for (const [file, reason] of Object.entries(DEFINITIVE_MARKER_FILES)) {
    if (fileNames.includes(file)) definitiveMarkers.push(reason)
  }
  for (const [file, reason] of Object.entries(SUPPORTING_MARKER_FILES)) {
    if (fileNames.includes(file)) supportingMarkers.push(reason)
  }
  if (fileNames.some((f) => AUTO_TFVARS_RE.test(f))) {
    supportingMarkers.push('*.auto.tfvars present')
  }

  let engine: Engine = fileNames.some((f) => /\.tofu(\.json)?$/.test(f))
    ? 'tofu'
    : 'terraform'

  const dependencies = new Set<string>()
  let hasBackend = false
  let hasCloud = false
  let hasEncryption = false
  let hasProvider = false

  for (const file of effectiveConfigFiles(fileNames)) {
    let content: string
    try {
      content = readFileSync(join(absDir, file), 'utf8')
    } catch {
      continue
    }

    const features = terraformBlockFeatures(content)
    hasBackend ||= features.hasBackend
    hasCloud ||= features.hasCloud
    hasEncryption ||= features.hasEncryption
    hasProvider ||= hasProviderConfiguration(content)

    for (const source of extractModuleSources(content)) {
      if (!source.startsWith('./') && !source.startsWith('../')) continue
      const resolved = posix.normalize(
        posix.join(modulePath === '.' ? '' : modulePath, source),
      )
      // Skip sources escaping the repository root.
      if (resolved === '..' || resolved.startsWith('../')) continue
      dependencies.add(resolved === '' ? '.' : resolved)
    }
  }

  if (hasBackend) definitiveMarkers.push('terraform backend block')
  if (hasCloud) definitiveMarkers.push('terraform cloud block')
  if (hasEncryption) {
    definitiveMarkers.push('encryption block (OpenTofu)')
    engine = 'tofu'
  }
  if (hasProvider) supportingMarkers.push('provider configuration block')

  dependencies.delete(modulePath)

  return {
    path: modulePath,
    engine,
    definitiveMarkers,
    supportingMarkers,
    dependencies: [...dependencies].sort(),
  }
}
