import * as core from '@actions/core'

import {
  detectDeletedModules,
  mapFilesToModules,
  normalizePath,
} from './changed.js'
import { analyzeModule } from './classify.js'
import { collectFiles, discoverModules } from './discovery.js'
import {
  ALL_ENVIRONMENTS,
  buildEnvironmentsMatrix,
  environmentTriggers,
  moduleEnvironments,
  parseEnvironments,
  type EnvironmentPatterns,
  type MatrixEntry,
} from './environments.js'
import {
  buildGraph,
  propagateChanges,
  topologicalLayers,
  type ModuleGraph,
} from './graph.js'

function getListInput(name: string): string[] {
  const raw = core.getInput(name)
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function getFilesInput(name: string): string[] {
  const raw = core.getInput(name).trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      core.warning(
        `Input '${name}' looks like JSON but could not be parsed; falling back`,
      )
    }
  }
  return raw.split(/\s+/).filter((s) => s.length > 0)
}

function getBoolInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase()
  if (raw === '') return fallback
  return raw === 'true'
}

type ModuleStatus =
  'added' | 'modified' | 'renamed' | 'dependency' | 'detected' | 'unchanged'

interface Results {
  allModules: string[]
  rootModules: string[]
  addedModules: string[]
  modifiedModules: string[]
  renamedModules: string[]
  deletedModules: string[]
  rootModulesOrdered: string[][]
}

function statusOf(mode: string, results: Results, path: string): ModuleStatus {
  if (results.addedModules.includes(path)) return 'added'
  if (results.renamedModules.includes(path)) return 'renamed'
  if (results.modifiedModules.includes(path)) return 'modified'
  if (results.allModules.includes(path)) {
    return mode === 'all' ? 'detected' : 'dependency'
  }
  return 'unchanged'
}

function buildDependencyGraph(graph: ModuleGraph): Record<string, unknown> {
  const modules: Record<string, unknown> = {}
  for (const [path, mod] of [...graph.modules.entries()].sort()) {
    modules[path] = {
      class: mod.moduleClass,
      engine: mod.engine,
      markers: [...mod.definitiveMarkers, ...mod.supportingMarkers],
      dependencies: mod.dependencies,
      dependents: [...(graph.dependents.get(path) ?? [])].sort(),
    }
  }
  return modules
}

function setOutputs(results: Results, graph: ModuleGraph): void {
  core.setOutput('root_modules', JSON.stringify(results.rootModules))
  core.setOutput(
    'root_modules_ordered',
    JSON.stringify(results.rootModulesOrdered),
  )
  core.setOutput(
    'module_changes',
    JSON.stringify({
      added: results.addedModules,
      modified: results.modifiedModules,
      renamed: results.renamedModules,
      deleted: results.deletedModules,
    }),
  )
  core.setOutput(
    'dependency_graph',
    JSON.stringify(buildDependencyGraph(graph)),
  )
  core.setOutput(
    'any_changed',
    String(results.allModules.length > 0 || results.deletedModules.length > 0),
  )
}

async function writeSummary(
  mode: string,
  results: Results,
  graph: ModuleGraph,
  matrix: MatrixEntry[],
  envPatterns: EnvironmentPatterns,
): Promise<void> {
  if (!process.env.GITHUB_STEP_SUMMARY) return

  const withEnvironments = envPatterns.size > 0
  const triggeredEnvs = new Map<string, string[]>()
  for (const entry of matrix) {
    if (entry.environment === undefined) continue
    const envs = triggeredEnvs.get(entry.module) ?? []
    envs.push(entry.environment)
    triggeredEnvs.set(entry.module, envs)
  }

  const childCount = results.allModules.length - results.rootModules.length
  const facts = [
    `mode: ${mode}`,
    `${results.rootModules.length} root`,
    `${childCount} child`,
  ]
  if (results.deletedModules.length > 0) {
    facts.push(`${results.deletedModules.length} deleted`)
  }
  if (withEnvironments) {
    facts.push(`declared environments: ${[...envPatterns.keys()].join(', ')}`)
    facts.push(`matrix entries: ${matrix.length}`)
  }

  core.summary
    .addHeading('Terraform modules', 3)
    .addRaw(facts.join(' · '), true)

  if (results.allModules.length === 0) {
    core.summary.addRaw('No modules affected by this change.', true)
  } else {
    const header = [
      { data: 'Module', header: true },
      { data: 'Class', header: true },
      { data: 'Engine', header: true },
      { data: 'Status', header: true },
      ...(withEnvironments ? [{ data: 'Environments', header: true }] : []),
      { data: 'Root markers', header: true },
    ]

    const rows = results.allModules.map((path) => {
      const mod = graph.modules.get(path)
      const markers = [
        ...(mod?.definitiveMarkers ?? []),
        ...(mod?.supportingMarkers ?? []),
      ]
      const environments = triggeredEnvs.get(path)?.join(', ') ?? '—'
      return [
        path,
        mod?.moduleClass ?? 'root',
        mod?.engine ?? 'terraform',
        statusOf(mode, results, path),
        ...(withEnvironments ? [environments] : []),
        markers.join(', ') || '—',
      ]
    })

    core.summary.addTable([header, ...rows])
  }

  if (results.rootModulesOrdered.length > 1) {
    core.summary.addHeading('Apply order', 3).addTable([
      [
        { data: 'Layer', header: true },
        { data: 'Root modules', header: true },
      ],
      ...results.rootModulesOrdered.map((layer, index) => [
        String(index + 1),
        layer.join(', '),
      ]),
    ])
  }

  if (results.deletedModules.length > 0) {
    core.summary
      .addHeading('Deleted modules', 3)
      .addList(results.deletedModules)
  }

  await core.summary.write()
}

export async function run(): Promise<void> {
  const rootDir = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const mode = core.getInput('mode') || 'changed'
  const include = getListInput('include')
  const exclude = getListInput('exclude')
  const followDependencies = getBoolInput('follow_dependencies', true)
  const summaryEnabled = getBoolInput('summary', true)
  const envPatterns = parseEnvironments(core.getInput('environments'))

  if (mode !== 'all' && mode !== 'changed') {
    core.setFailed(`Unsupported mode: '${mode}'. Use 'all' or 'changed'.`)
    return
  }

  const modulePaths = discoverModules(rootDir, { include, exclude })
  core.debug(
    `Discovered ${modulePaths.length} modules: ${modulePaths.join(', ')}`,
  )

  const analyses = modulePaths.map((p) => analyzeModule(rootDir, p))
  const graph = buildGraph(analyses)
  const moduleDirs = new Set(modulePaths)
  const moduleEnvs = moduleEnvironments(
    envPatterns.size > 0 ? collectFiles(rootDir) : [],
    moduleDirs,
    envPatterns,
  )

  let affected: Set<string>
  let addedModules = new Set<string>()
  let modifiedModules = new Set<string>()
  let renamedModules = new Set<string>()
  let deletedModules: string[] = []
  let envTriggers = new Map<string, Set<string> | typeof ALL_ENVIRONMENTS>()

  if (mode === 'all') {
    affected = new Set(modulePaths)
  } else {
    const addedFiles = [
      ...getFilesInput('added_files'),
      ...getFilesInput('copied_files'),
    ]
    const modifiedFiles = [
      ...getFilesInput('modified_files'),
      ...getFilesInput('type_changed_files'),
    ]
    const renamedFiles = getFilesInput('renamed_files')
    const deletedFiles = getFilesInput('deleted_files').map(normalizePath)

    addedModules = mapFilesToModules(addedFiles, moduleDirs)
    modifiedModules = mapFilesToModules(modifiedFiles, moduleDirs)
    renamedModules = mapFilesToModules(renamedFiles, moduleDirs)
    // Deleted files inside a still-existing module modify that module.
    for (const mod of mapFilesToModules(deletedFiles, moduleDirs))
      modifiedModules.add(mod)
    deletedModules = detectDeletedModules(deletedFiles, moduleDirs)

    const direct = new Set([
      ...addedModules,
      ...modifiedModules,
      ...renamedModules,
    ])
    affected = followDependencies ? propagateChanges(direct, graph) : direct

    envTriggers = environmentTriggers(
      [...addedFiles, ...modifiedFiles, ...renamedFiles, ...deletedFiles],
      moduleDirs,
      envPatterns,
    )

    for (const mod of affected) {
      if (!direct.has(mod))
        core.debug(`Module '${mod}' included via dependency propagation`)
    }
  }

  const modules = [...affected].sort()
  const rootModules = modules.filter(
    (m) => graph.modules.get(m)?.moduleClass === 'root',
  )
  const rootSet = new Set(rootModules)
  const results: Results = {
    allModules: modules,
    rootModules,
    addedModules: [...addedModules].sort(),
    modifiedModules: [...modifiedModules].sort(),
    renamedModules: [...renamedModules].sort(),
    deletedModules,
    rootModulesOrdered: topologicalLayers(affected, graph)
      .map((layer) => layer.filter((m) => rootSet.has(m)))
      .filter((layer) => layer.length > 0),
  }

  setOutputs(results, graph)
  const matrix = buildEnvironmentsMatrix(
    rootModules,
    moduleEnvs,
    envTriggers,
    mode,
  )
  core.setOutput('environments_matrix', JSON.stringify(matrix))
  core.info(
    `Affected modules (${results.allModules.length}): ${results.allModules.join(', ') || '—'}`,
  )

  if (summaryEnabled)
    await writeSummary(mode, results, graph, matrix, envPatterns)
}
