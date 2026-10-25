import { useState } from 'react'
import { Check, GitBranch, Circle, ArrowRight, Box } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Select } from '../../components/select'

export function ServiceExample() {
  const [port, setPort] = useState('3000')
  const [path, setPath] = useState('/health')
  return (
    <figure className="my-8 overflow-hidden rounded-xl border border-[#303037] bg-[#111114]">
      <figcaption className="flex items-center justify-between border-b border-[#29292f] px-5 py-3 text-xs text-[#a1a1aa]">
        <span>Service configuration</span>
        <span>Interactive example · not saved</span>
      </figcaption>
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <Field label="Build mode">
          <Select defaultValue="automatic">
            <option value="automatic">Automatic</option>
            <option value="dockerfile">Dockerfile</option>
          </Select>
        </Field>
        <Field label="Start command">
          <Input defaultValue="npm start" />
        </Field>
        <Field label="Container port" hint="Match the port your app listens on.">
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </Field>
        <Field label="Readiness path" hint="Return HTTP 200 when ready.">
          <Input value={path} onChange={(e) => setPath(e.target.value)} />
        </Field>
      </div>
      <p className="border-t border-[#29292f] px-5 py-4 font-mono text-xs text-[#a5d6a7]">
        Probe → HTTP :{port || '3000'}
        {path.startsWith('/') ? path : `/${path}`}
      </p>
    </figure>
  )
}

export function DeploymentExample({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState(3)
  const phases = ['Build', 'Prepare', 'Readiness', 'Promote']
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-xl border border-[#303037] bg-[#111114]',
        !compact && 'my-8',
      )}
    >
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29292f] px-5 py-3 text-xs text-[#a1a1aa]">
        <span>Deployment preview</span>
        <span>Illustrative data · not live</span>
      </figcaption>
      <div className="p-5 sm:p-7">
        <div className="mb-7 flex items-center gap-3">
          <span className="rounded-lg border border-[#34343b] p-2.5">
            <Box size={21} />
          </span>
          <div>
            <p className="text-base font-medium text-[#fafafa]">storefront</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-[#a1a1aa]">
              <GitBranch size={12} /> main <span>·</span> 7f2a1c9
            </p>
          </div>
          <span className="ml-auto rounded-full bg-[#183425] px-3 py-1 text-xs text-[#9ed9b1]">
            {phase === 3 ? 'Healthy' : 'In progress'}
          </span>
        </div>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {phases.map((name, i) => (
            <li
              key={name}
              className={cn(
                'rounded-lg border p-3 text-sm',
                i <= phase
                  ? 'border-[#36513e] bg-[#142219] text-[#b2d8bb]'
                  : 'border-[#2e2e34] text-[#8e8e9a]',
              )}
            >
              <span className="mb-3 block">
                {i <= phase ? <Check size={16} /> : <Circle size={16} />}
              </span>
              {name}
            </li>
          ))}
        </ol>
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-[#29292f] pt-4 text-xs text-[#a1a1aa]">
          <span>
            {phase === 3
              ? 'Traffic now serves the healthy revision.'
              : 'Previous healthy revision continues serving.'}
          </span>
          <Button
            variant="ghost"
            className="shrink-0 text-xs"
            onClick={() => setPhase((phase + 1) % 4)}
          >
            {phase === 3 ? 'Replay' : 'Next stage'}
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </figure>
  )
}
