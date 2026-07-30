import { describe, expect, it } from 'vitest'

import {
  detectDeletedModules,
  mapFilesToModules,
  normalizePath,
} from '../src/changed.js'

const MODULES = new Set(['stacks/vpc', 'modules/network', '.'])

describe('normalizePath', () => {
  it('converts windows separators and strips leading ./', () => {
    expect(normalizePath('stacks\\vpc\\main.tf')).toBe('stacks/vpc/main.tf')
    expect(normalizePath('./stacks/vpc/main.tf')).toBe('stacks/vpc/main.tf')
  })
})

describe('mapFilesToModules', () => {
  it('maps files to their deepest owning module', () => {
    expect(
      mapFilesToModules(['stacks/vpc/main.tf', 'stacks/vpc/vars.tf'], MODULES),
    ).toEqual(new Set(['stacks/vpc']))
  })

  it('walks up to a parent module for nested files', () => {
    expect(
      mapFilesToModules(['stacks/vpc/templates/user-data.tpl'], MODULES),
    ).toEqual(new Set(['stacks/vpc']))
  })

  it('falls back to the repository root module', () => {
    expect(mapFilesToModules(['README.md'], MODULES)).toEqual(new Set(['.']))
  })

  it('ignores files owned by no module', () => {
    expect(
      mapFilesToModules(['unrelated/file.txt'], new Set(['stacks/vpc'])),
    ).toEqual(new Set())
  })
})

describe('detectDeletedModules', () => {
  it('reports directories whose config files were deleted and are no longer modules', () => {
    expect(
      detectDeletedModules(
        ['stacks/old/main.tf', 'stacks/old/vars.tf'],
        MODULES,
      ),
    ).toEqual(['stacks/old'])
  })

  it('does not report modules that still exist', () => {
    expect(detectDeletedModules(['stacks/vpc/unused.tf'], MODULES)).toEqual([])
  })

  it('ignores non-config deleted files', () => {
    expect(detectDeletedModules(['stacks/old/README.md'], MODULES)).toEqual([])
  })
})
