import type { ClassifiedModule, ModuleAnalysis } from './types.js'

export interface ModuleGraph {
  /** All modules keyed by path, with final root/child classification. */
  modules: Map<string, ClassifiedModule>
  /** Reverse edges: module path -> paths of modules that depend on it. */
  dependents: Map<string, Set<string>>
}

export function hasRootEvidence(analysis: ModuleAnalysis): boolean {
  return (
    analysis.definitiveMarkers.length > 0 ||
    analysis.supportingMarkers.length >= 2
  )
}

/**
 * Build the dependency graph and classify modules.
 *
 * A module is a root (deployable) module when it carries root evidence;
 * everything else is a child module. A deployable module must configure
 * remote state (backend/cloud block — required in config even when using
 * `-backend-config` CLI flags) or carry other generated root artifacts, so
 * evidence-less directories are never worth auto-deploying from CI.
 */
export function buildGraph(analyses: ModuleAnalysis[]): ModuleGraph {
  const known = new Set(analyses.map((a) => a.path))
  const dependents = new Map<string, Set<string>>()

  for (const analysis of analyses) {
    for (const dep of analysis.dependencies) {
      if (!known.has(dep)) continue
      let set = dependents.get(dep)
      if (!set) {
        set = new Set()
        dependents.set(dep, set)
      }
      set.add(analysis.path)
    }
  }

  const modules = new Map<string, ClassifiedModule>()
  for (const analysis of analyses) {
    modules.set(analysis.path, {
      ...analysis,
      moduleClass: hasRootEvidence(analysis) ? 'root' : 'child',
    })
  }

  return { modules, dependents }
}

export function propagateChanges(
  changed: Iterable<string>,
  graph: ModuleGraph,
): Set<string> {
  const result = new Set<string>()
  const queue = [...changed]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || result.has(current)) continue
    result.add(current)
    for (const dependent of graph.dependents.get(current) ?? []) {
      if (!result.has(dependent)) queue.push(dependent)
    }
  }
  return result
}

/**
 * Order the given modules into topological layers: every module's
 * dependencies (within the set) live in an earlier layer, so layers can be
 * applied sequentially while modules inside a layer run in parallel.
 * Cycles are broken by lumping the remaining modules into a final layer.
 */
export function topologicalLayers(
  paths: Set<string>,
  graph: ModuleGraph,
): string[][] {
  const remaining = new Set(paths)
  const layers: string[][] = []
  const placed = new Set<string>()

  while (remaining.size > 0) {
    const layer: string[] = []
    for (const path of remaining) {
      const deps = graph.modules.get(path)?.dependencies ?? []
      const blocked = deps.some((d) => remaining.has(d) && !placed.has(d))
      if (!blocked) layer.push(path)
    }

    if (layer.length === 0) {
      // Dependency cycle: emit the rest as one final layer.
      layers.push([...remaining].sort())
      break
    }

    layer.sort()
    layers.push(layer)
    for (const path of layer) {
      remaining.delete(path)
      placed.add(path)
    }
  }

  return layers
}
