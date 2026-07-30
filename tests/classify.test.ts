import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { analyzeModule, effectiveConfigFiles } from '../src/classify.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/monorepo', import.meta.url))

describe('effectiveConfigFiles', () => {
  it('prefers .tofu over .tf with the same basename', () => {
    expect(
      effectiveConfigFiles(['main.tf', 'main.tofu', 'outputs.tf']),
    ).toEqual(['main.tofu', 'outputs.tf'])
  })
})

describe('analyzeModule', () => {
  it('detects backend block as root marker', () => {
    const analysis = analyzeModule(FIXTURE, 'stacks/vpc')
    expect(analysis.definitiveMarkers).toContain('terraform backend block')
    expect(analysis.dependencies).toEqual(['modules/network'])
    expect(analysis.engine).toBe('terraform')
  })

  it('detects provider configuration as supporting marker only', () => {
    const analysis = analyzeModule(FIXTURE, 'stacks/dns')
    expect(analysis.supportingMarkers).toContain('provider configuration block')
    expect(analysis.definitiveMarkers).toEqual([])
  })

  it('detects the dependency lock file as definitive marker', () => {
    const analysis = analyzeModule(FIXTURE, 'stacks/app')
    expect(analysis.definitiveMarkers).toContain('.terraform.lock.hcl present')
    expect(analysis.dependencies).toEqual(['modules/service'])
  })

  it('flags OpenTofu modules with encryption blocks', () => {
    const analysis = analyzeModule(FIXTURE, 'tofu-stack')
    expect(analysis.engine).toBe('tofu')
    expect(analysis.definitiveMarkers).toContain('encryption block (OpenTofu)')
  })

  it('applies .tofu precedence: shadowed .tf backend is ignored', () => {
    const analysis = analyzeModule(FIXTURE, 'legacy')
    expect(analysis.engine).toBe('tofu')
    expect(analysis.definitiveMarkers).toEqual([])
    expect(analysis.supportingMarkers).toEqual([])
  })

  it('leaves plain child modules unmarked', () => {
    const analysis = analyzeModule(FIXTURE, 'modules/network')
    expect(analysis.definitiveMarkers).toEqual([])
    expect(analysis.supportingMarkers).toEqual([])
    expect(analysis.dependencies).toEqual([])
  })

  it('resolves nested local dependencies', () => {
    const analysis = analyzeModule(FIXTURE, 'modules/service')
    expect(analysis.dependencies).toEqual(['modules/network'])
  })
})
