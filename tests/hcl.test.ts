import { describe, expect, it } from 'vitest'

import {
  extractBlocks,
  extractModuleSources,
  hasProviderConfiguration,
  stripComments,
  terraformBlockFeatures,
} from '../src/hcl.js'

describe('stripComments', () => {
  it('removes line and block comments but keeps strings', () => {
    const input = [
      'a = "value # not a comment"',
      'b = 1 # trailing',
      '// full line',
      '/* block',
      'comment */ c = 2',
    ].join('\n')
    const out = stripComments(input)
    expect(out).toContain('"value # not a comment"')
    expect(out).not.toContain('trailing')
    expect(out).not.toContain('full line')
    expect(out).toContain('c = 2')
  })

  it('keeps heredoc contents intact', () => {
    const input = 'x = <<EOF\n# not a comment\nEOF\ny = 1 # gone'
    const out = stripComments(input)
    expect(out).toContain('# not a comment')
    expect(out).not.toContain('gone')
  })
})

describe('extractBlocks', () => {
  it('extracts labeled blocks with nested braces', () => {
    const input =
      'module "a" {\n  source = "./x"\n  settings {\n    on = true\n  }\n}\n'
    const blocks = extractBlocks(input, 'module')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.labels).toEqual(['a'])
    expect(blocks[0]?.body).toContain('settings {')
  })

  it('does not match commented-out blocks', () => {
    const blocks = extractBlocks(
      '# terraform {\n#  backend "s3" {}\n# }\n',
      'terraform',
    )
    expect(blocks).toHaveLength(0)
  })
})

describe('terraformBlockFeatures', () => {
  it('detects backend, cloud and encryption', () => {
    expect(
      terraformBlockFeatures(
        'terraform {\n backend "s3" {\n bucket = "b"\n }\n}',
      ),
    ).toEqual({
      hasBackend: true,
      hasCloud: false,
      hasEncryption: false,
    })
    expect(
      terraformBlockFeatures(
        'terraform {\n cloud {\n organization = "o"\n }\n}',
      ).hasCloud,
    ).toBe(true)
    expect(
      terraformBlockFeatures('terraform {\n encryption {\n }\n}').hasEncryption,
    ).toBe(true)
  })

  it('ignores backend mentioned outside a terraform block', () => {
    expect(
      terraformBlockFeatures('resource "x" "y" {\n backend "s3" {}\n}')
        .hasBackend,
    ).toBe(false)
  })
})

describe('hasProviderConfiguration', () => {
  it('detects provider blocks with arguments', () => {
    expect(
      hasProviderConfiguration('provider "aws" {\n region = "us-east-1"\n}'),
    ).toBe(true)
  })

  it('ignores empty provider blocks', () => {
    expect(hasProviderConfiguration('provider "aws" {\n}')).toBe(false)
  })
})

describe('extractModuleSources', () => {
  it('extracts local and remote sources', () => {
    const input = [
      'module "a" { source = "../shared" }',
      'module "b" {',
      '  source  = "terraform-aws-modules/vpc/aws"',
      '  version = "5.0.0"',
      '}',
    ].join('\n')
    expect(extractModuleSources(input)).toEqual([
      '../shared',
      'terraform-aws-modules/vpc/aws',
    ])
  })
})
