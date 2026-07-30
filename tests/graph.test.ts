import { describe, expect, it } from 'vitest'

import {
  buildGraph,
  propagateChanges,
  topologicalLayers,
} from '../src/graph.js'
import type { ModuleAnalysis } from '../src/types.js'

function analysis(
  path: string,
  deps: string[] = [],
  definitive: string[] = [],
  supporting: string[] = [],
): ModuleAnalysis {
  return {
    path,
    engine: 'terraform',
    definitiveMarkers: definitive,
    supportingMarkers: supporting,
    dependencies: deps,
  }
}

const ANALYSES = [
  analysis('stacks/vpc', ['modules/network'], ['terraform backend block']),
  analysis('stacks/app', ['modules/service'], ['.terraform.lock.hcl present']),
  analysis('modules/service', ['modules/network']),
  analysis('modules/network'),
  analysis('standalone'),
]

describe('buildGraph', () => {
  it('classifies modules without root evidence as children', () => {
    const graph = buildGraph(ANALYSES)
    expect(graph.modules.get('modules/network')?.moduleClass).toBe('child')
    expect(graph.modules.get('modules/service')?.moduleClass).toBe('child')
    expect(graph.modules.get('standalone')?.moduleClass).toBe('child')
  })

  it('keeps referenced modules with root evidence as root', () => {
    const graph = buildGraph([
      analysis('a', ['b']),
      analysis('b', [], ['terraform backend block']),
    ])
    expect(graph.modules.get('b')?.moduleClass).toBe('root')
  })

  it('does not treat a lone supporting marker as root evidence', () => {
    const graph = buildGraph([
      analysis('a', [], [], ['provider configuration block']),
      analysis(
        'b',
        [],
        [],
        ['provider configuration block', 'terraform.tfvars present'],
      ),
    ])
    expect(graph.modules.get('a')?.moduleClass).toBe('child')
    expect(graph.modules.get('b')?.moduleClass).toBe('root')
  })
})

describe('propagateChanges', () => {
  it('expands transitively to all dependents', () => {
    const graph = buildGraph(ANALYSES)
    const affected = propagateChanges(['modules/network'], graph)
    expect([...affected].sort()).toEqual([
      'modules/network',
      'modules/service',
      'stacks/app',
      'stacks/vpc',
    ])
  })

  it('does not expand unrelated modules', () => {
    const graph = buildGraph(ANALYSES)
    expect(propagateChanges(['standalone'], graph)).toEqual(
      new Set(['standalone']),
    )
  })
})

describe('topologicalLayers', () => {
  it('orders dependencies before dependents', () => {
    const graph = buildGraph(ANALYSES)
    const layers = topologicalLayers(
      new Set([
        'stacks/vpc',
        'stacks/app',
        'modules/service',
        'modules/network',
      ]),
      graph,
    )
    expect(layers).toEqual([
      ['modules/network'],
      ['modules/service', 'stacks/vpc'],
      ['stacks/app'],
    ])
  })

  it('breaks cycles into a final layer', () => {
    const graph = buildGraph([analysis('a', ['b']), analysis('b', ['a'])])
    const layers = topologicalLayers(new Set(['a', 'b']), graph)
    expect(layers).toEqual([['a', 'b']])
  })
})
