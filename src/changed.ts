import { isModuleConfigFile } from './discovery.js'

/** Normalize a changed-file path to repo-relative POSIX form. */
export function normalizePath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

/**
 * Find the deepest discovered module directory containing the given file,
 * or undefined when no module owns it.
 */
export function owningModule(
  file: string,
  moduleDirs: Set<string>,
): string | undefined {
  let dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
  while (true) {
    if (moduleDirs.has(dir)) return dir
    if (dir === '.') return undefined
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.'
  }
}

export function mapFilesToModules(
  files: string[],
  moduleDirs: Set<string>,
): Set<string> {
  const result = new Set<string>()
  for (const raw of files) {
    const owner = owningModule(normalizePath(raw), moduleDirs)
    if (owner !== undefined) result.add(owner)
  }
  return result
}

export function detectDeletedModules(
  deletedFiles: string[],
  moduleDirs: Set<string>,
): string[] {
  const deleted = new Set<string>()
  for (const raw of deletedFiles) {
    const file = normalizePath(raw)
    const name = file.includes('/')
      ? file.slice(file.lastIndexOf('/') + 1)
      : file
    if (!isModuleConfigFile(name)) continue
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
    if (!moduleDirs.has(dir)) deleted.add(dir)
  }
  return [...deleted].sort()
}
