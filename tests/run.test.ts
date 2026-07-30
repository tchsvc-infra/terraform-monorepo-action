import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { run } from '../src/run.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/monorepo', import.meta.url))

let tempDir: string
let savedEnv: NodeJS.ProcessEnv

function setInput(name: string, value: string): void {
  process.env[`INPUT_${name.toUpperCase()}`] = value
}

function readOutputs(): Record<string, string> {
  const content = readFileSync(join(tempDir, 'output'), 'utf8')
  const outputs: Record<string, string> = {}
  const re = /^(\w+)<<(ghadelimiter_[\w-]+)\r?\n([\s\S]*?)\r?\n\2$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    outputs[match[1] ?? ''] = match[3] ?? ''
  }
  return outputs
}

beforeEach(() => {
  savedEnv = { ...process.env }
  tempDir = mkdtempSync(join(tmpdir(), 'tma-test-'))
  writeFileSync(join(tempDir, 'output'), '')
  process.env.GITHUB_WORKSPACE = FIXTURE
  process.env.GITHUB_OUTPUT = join(tempDir, 'output')
  delete process.env.GITHUB_STEP_SUMMARY
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key]
  }
})

afterEach(() => {
  process.env = savedEnv
  rmSync(tempDir, { recursive: true, force: true })
})

interface GraphEntry {
  class: string
  engine: string
  markers: string[]
  dependencies: string[]
  dependents: string[]
}

interface ModuleChanges {
  added: string[]
  modified: string[]
  renamed: string[]
  deleted: string[]
}

function parseGraph(
  outputs: Record<string, string>,
): Record<string, GraphEntry> {
  return JSON.parse(outputs.dependency_graph ?? '') as Record<
    string,
    GraphEntry
  >
}

function parseChanges(outputs: Record<string, string>): ModuleChanges {
  return JSON.parse(outputs.module_changes ?? '') as ModuleChanges
}

describe('run (mode=all)', () => {
  it('returns every root module and the dependency graph', async () => {
    setInput('mode', 'all')
    setInput('exclude', 'docs')
    await run()

    const outputs = readOutputs()
    expect(JSON.parse(outputs.root_modules ?? '')).toEqual([
      'stacks/app',
      'stacks/vpc',
      'tofu-stack',
    ])
    const graph = parseGraph(outputs)
    expect(Object.keys(graph)).toEqual([
      'legacy',
      'modules/network',
      'modules/service',
      'stacks/app',
      'stacks/dns',
      'stacks/vpc',
      'tofu-stack',
    ])
    expect(graph['modules/network']?.class).toBe('child')
    expect(graph['modules/network']?.dependents).toEqual([
      'modules/service',
      'stacks/dns',
      'stacks/vpc',
    ])
    // provider config alone is only supporting evidence, not root proof
    expect(graph['stacks/dns']?.class).toBe('child')
    expect(graph['legacy']?.class).toBe('child')
    expect(graph['stacks/vpc']?.markers).toContain('terraform backend block')
    expect(outputs.any_changed).toBe('true')
  })
})

describe('run (mode=changed)', () => {
  it('maps changed files to modules and propagates dependencies', async () => {
    setInput('mode', 'changed')
    setInput('modified_files', JSON.stringify(['modules/network/main.tf']))
    await run()

    const outputs = readOutputs()
    expect(JSON.parse(outputs.root_modules ?? '')).toEqual([
      'stacks/app',
      'stacks/vpc',
    ])
    expect(JSON.parse(outputs.root_modules_ordered ?? '')).toEqual([
      ['stacks/vpc'],
      ['stacks/app'],
    ])
    expect(parseChanges(outputs)).toEqual({
      added: [],
      modified: ['modules/network'],
      renamed: [],
      deleted: [],
    })
  })

  it('does not propagate when follow_dependencies=false', async () => {
    setInput('mode', 'changed')
    setInput('follow_dependencies', 'false')
    setInput('modified_files', JSON.stringify(['modules/network/main.tf']))
    await run()

    const outputs = readOutputs()
    expect(JSON.parse(outputs.root_modules ?? '')).toEqual([])
    expect(parseChanges(outputs).modified).toEqual(['modules/network'])
    expect(outputs.any_changed).toBe('true')
  })

  it('reports deleted modules in module_changes', async () => {
    setInput('mode', 'changed')
    setInput('deleted_files', JSON.stringify(['stacks/gone/main.tf']))
    await run()

    const outputs = readOutputs()
    expect(parseChanges(outputs).deleted).toEqual(['stacks/gone'])
    expect(JSON.parse(outputs.root_modules ?? '')).toEqual([])
    expect(outputs.any_changed).toBe('true')
  })
})
