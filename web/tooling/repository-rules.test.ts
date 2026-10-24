// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const webRoot = fileURLToPath(new URL('..', import.meta.url))

function lint(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'platform-lint-'))
  const file = join(directory, 'fixture.tsx')
  try {
    writeFileSync(file, source)
    const result = spawnSync(
      process.execPath,
      ['node_modules/oxlint/bin/oxlint', '--config', 'oxlint.config.ts', '--deny-warnings', file],
      { cwd: webRoot, encoding: 'utf8' },
    )
    if (result.error) throw result.error
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('lint rejects handwritten barrels and comma-chained declarations', () => {
  const result = lint(`
    export { item } from './item'
    export * from './more'
    const first = 1, second = 2
    export const total = first + second
  `)
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('no-handwritten-barrels')
  expect(result.output).toContain('one-var')
})

test('the existing lint command runs React Doctor and TanStack Query rules', () => {
  const result = lint(`
    import { QueryClient } from '@tanstack/react-query'
    export function Example() {
      const client = new QueryClient()
      return <button onClick={() => client.clear()}>Clear cache</button>
    }
  `)
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('query-stable-query-client')
  expect(result.output).toContain('button-has-type')
})

test('direct exports and separate declarations pass the same policy', () => {
  const result = lint(`
    export const first = 1
    export const second = 2
    export interface Example { name: string }
  `)
  expect(result.output).not.toContain('Failed')
  expect(result.status).toBe(0)
})

test('React Doctor rejects complex and oversized components through the normal lint command', () => {
  const branches = Array.from(
    { length: 20 },
    (_, index) => `<span>{count > ${index} ? 'Above ${index}' : 'Below ${index}'}</span>`,
  ).join('\n')
  const rows = Array.from({ length: 310 }, (_, index) => `<span>Row ${index}</span>`).join('\n')
  const result = lint(`
    export function Complex({ count }: { count: number }) {
      return <section>${branches}</section>
    }
    export function Oversized() {
      return <section>${rows}</section>
    }
  `)
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('no-high-complexity-react-function')
  expect(result.output).toContain('no-giant-component')
})
