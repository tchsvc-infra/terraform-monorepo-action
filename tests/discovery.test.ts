import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { discoverModules } from '../src/discovery.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/monorepo', import.meta.url))

describe('discoverModules', () => {
  it('finds every directory with terraform/tofu config files', () => {
    expect(discoverModules(FIXTURE)).toEqual([
      'docs',
      'legacy',
      'modules/network',
      'modules/service',
      'stacks/app',
      'stacks/dns',
      'stacks/vpc',
      'tofu-stack',
    ])
  })

  it('never detects test-file-only directories or .github', () => {
    const modules = discoverModules(FIXTURE)
    expect(modules).not.toContain('traps')
    expect(modules).not.toContain('.github')
  })

  it('honours exclude globs', () => {
    const modules = discoverModules(FIXTURE, { exclude: ['docs/**', 'legacy'] })
    expect(modules).not.toContain('docs')
    expect(modules).not.toContain('legacy')
    expect(modules).toContain('stacks/vpc')
  })

  it('honours include globs', () => {
    expect(discoverModules(FIXTURE, { include: ['stacks/**'] })).toEqual([
      'stacks/app',
      'stacks/dns',
      'stacks/vpc',
    ])
  })
})
