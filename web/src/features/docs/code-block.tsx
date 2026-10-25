import { copyText } from './clipboard'
import { useState } from 'react'
import { Highlight } from 'prism-react-renderer'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-docker'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-typescript'
import { Copy, Check } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '../../components/button'

export function CodeBlock({
  code,
  language = 'text',
  title,
}: {
  code: string
  language?: string
  title?: string
}) {
  const [status, setStatus] = useState('')
  const aliases: Record<string, string> = {
    sh: 'bash',
    shell: 'bash',
    js: 'javascript',
    ts: 'typescript',
    dockerfile: 'docker',
  }
  const grammar = aliases[language] ?? language
  async function copy() {
    try {
      await copyText(code)
      setStatus('Copied')
    } catch {
      setStatus('Copy failed. Select the code manually.')
    }
  }
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-[#2b2b30] bg-[#111114]">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[#26262b] px-4 text-xs text-[#a1a1aa]">
        <span className="font-mono">{title ?? language}</span>
        <Button
          variant="ghost"
          className="min-h-9 gap-2 text-xs"
          onClick={() => void copy()}
          aria-label={`Copy ${title ?? language} code`}
        >
          {status === 'Copied' ? <Check size={14} /> : <Copy size={14} />}{' '}
          {status === 'Copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Highlight
        prism={Prism}
        code={code.trimEnd()}
        language={grammar}
        theme={{ plain: {}, styles: [] }}
      >
        {({ tokens }) => (
          <pre
            // Keyboard focus enables horizontal scrolling; this is a read-only code region.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="overflow-x-auto p-5 font-mono text-[13px] leading-7 text-[#d4d4d8]"
          >
            <code>
              {tokens.map((line, i) => (
                // Token rows are positional, immutable presentation with no row state.
                // oxlint-disable-next-line react-doctor/no-array-index-as-key
                <span className="block min-h-7" key={`line-${i}`}>
                  {line.map((token, j) => (
                    <span
                      key={j}
                      className={cn(
                        token.types.some((t) => ['comment', 'prolog'].includes(t)) &&
                          'text-[#8a8a96]',
                        token.types.some((t) => ['string', 'attr-value'].includes(t)) &&
                          'text-[#a5d6a7]',
                        token.types.some((t) =>
                          ['keyword', 'tag', 'boolean', 'builtin'].includes(t),
                        ) && 'text-[#c4a5f3]',
                        token.types.some((t) => ['number', 'function', 'class-name'].includes(t)) &&
                          'text-[#f2bc8d]',
                        token.types.some((t) =>
                          ['property', 'attr-name', 'variable'].includes(t),
                        ) && 'text-[#8ac8ed]',
                      )}
                    >
                      {token.content}
                    </span>
                  ))}
                </span>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  )
}
