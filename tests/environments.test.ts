import { describe, expect, it } from 'vitest'

import {
  ALL_ENVIRONMENTS,
  buildEnvironmentsMatrix,
  environmentTriggers,
  environmentsOfFile,
  moduleEnvironments,
  parseEnvironments,
} from '../src/environments.js'

const PATTERNS = parseEnvironments(
  'dev=**/variables/dev.*\nprod=**/variables/prod.*',
)

describe('parseEnvironments', () => {
  it('parses name=glob lines', () => {
    expect([...PATTERNS.keys()]).toEqual(['dev', 'prod'])
    expect(PATTERNS.get('prod')).toEqual(['**/variables/prod.*'])
  })

  it('supports multiple comma-separated globs', () => {
    const patterns = parseEnvironments('dev=**/dev.*, envs/dev/**')
    expect(patterns.get('dev')).toEqual(['**/dev.*', 'envs/dev/**'])
  })

  it('supports semicolon-separated globs', () => {
    const patterns = parseEnvironments(
      'dev=**/dev.tfvars;**/dev.backend.tfvars',
    )
    expect(patterns.get('dev')).toEqual([
      '**/dev.tfvars',
      '**/dev.backend.tfvars',
    ])
  })

  it('keeps brace-expansion globs intact', () => {
    const patterns = parseEnvironments('dev=**/{dev,develop}.*;envs/dev/**')
    expect(patterns.get('dev')).toEqual(['**/{dev,develop}.*', 'envs/dev/**'])
  })

  it('rejects malformed entries', () => {
    expect(() => parseEnvironments('no-equals')).toThrow(/Invalid environments/)
    expect(() => parseEnvironments('=**/x')).toThrow(/Invalid environments/)
  })
})

describe('environmentsOfFile', () => {
  it('matches env-specific files', () => {
    expect(environmentsOfFile('tf/variables/prod.tfvars', PATTERNS)).toEqual([
      'prod',
    ])
    expect(environmentsOfFile('tf/main.tf', PATTERNS)).toEqual([])
  })

  it('matches backend var-files via the same stem pattern', () => {
    expect(
      environmentsOfFile('tf/variables/dev.backend.tfvars', PATTERNS),
    ).toEqual(['dev'])
    expect(
      environmentsOfFile('tf/variables/prod.backend.tfvars', PATTERNS),
    ).toEqual(['prod'])
  })

  it('matches bare filename patterns anywhere in the tree', () => {
    const patterns = parseEnvironments(
      'dev=dev.tfvars;dev.backend.tfvars\nprod=prod.tfvars;prod.backend.tfvars',
    )
    expect(
      environmentsOfFile('terraform/variables/prod.tfvars', patterns),
    ).toEqual(['prod'])
    expect(
      environmentsOfFile('terraform/variables/dev.backend.tfvars', patterns),
    ).toEqual(['dev'])
    expect(environmentsOfFile('terraform/main.tf', patterns)).toEqual([])
  })

  it('restricts path-scoped patterns to their subtree', () => {
    const patterns = parseEnvironments('prod=stacks/*/variables/prod.*')
    expect(
      environmentsOfFile('stacks/app/variables/prod.tfvars', patterns),
    ).toEqual(['prod'])
    expect(environmentsOfFile('other/variables/prod.tfvars', patterns)).toEqual(
      [],
    )
  })
})

describe('moduleEnvironments', () => {
  it('assigns environments to owning modules', () => {
    const envs = moduleEnvironments(
      [
        'tf/variables/dev.tfvars',
        'tf/variables/prod.backend.tfvars',
        'tf/main.tf',
      ],
      new Set(['tf']),
      PATTERNS,
    )
    expect([...(envs.get('tf') ?? [])].sort()).toEqual(['dev', 'prod'])
  })
})

describe('environmentTriggers', () => {
  it('triggers a single environment for env-specific files', () => {
    const triggers = environmentTriggers(
      ['tf/variables/prod.tfvars'],
      new Set(['tf']),
      PATTERNS,
    )
    expect(triggers.get('tf')).toEqual(new Set(['prod']))
  })

  it('scopes triggers to the owning module only', () => {
    const patterns = parseEnvironments('prod=prod.tfvars')
    const triggers = environmentTriggers(
      ['stacks/app/variables/prod.tfvars'],
      new Set(['stacks/app', 'stacks/db']),
      patterns,
    )
    expect(triggers.get('stacks/app')).toEqual(new Set(['prod']))
    expect(triggers.has('stacks/db')).toBe(false)
  })

  it('triggers all environments for module code changes', () => {
    const triggers = environmentTriggers(
      ['tf/main.tf', 'tf/variables/prod.tfvars'],
      new Set(['tf']),
      PATTERNS,
    )
    expect(triggers.get('tf')).toBe(ALL_ENVIRONMENTS)
  })
})

describe('buildEnvironmentsMatrix', () => {
  const moduleEnvs = new Map([['tf', new Set(['dev', 'prod'])]])

  it('fans out only triggered environments', () => {
    const matrix = buildEnvironmentsMatrix(
      ['tf'],
      moduleEnvs,
      new Map([['tf', new Set(['prod'])]]),
      'changed',
    )
    expect(matrix).toEqual([{ module: 'tf', environment: 'prod' }])
  })

  it('fans out all environments for full-module triggers', () => {
    const matrix = buildEnvironmentsMatrix(
      ['tf'],
      moduleEnvs,
      new Map([['tf', ALL_ENVIRONMENTS]]),
      'changed',
    )
    expect(matrix).toEqual([
      { module: 'tf', environment: 'dev' },
      { module: 'tf', environment: 'prod' },
    ])
  })

  it('fans out all environments for propagated modules', () => {
    const matrix = buildEnvironmentsMatrix(
      ['tf'],
      moduleEnvs,
      new Map(),
      'changed',
    )
    expect(matrix).toHaveLength(2)
  })

  it('emits plain entries for modules without environments', () => {
    const matrix = buildEnvironmentsMatrix(
      ['other'],
      moduleEnvs,
      new Map(),
      'all',
    )
    expect(matrix).toEqual([{ module: 'other' }])
  })
})
