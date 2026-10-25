import { ArrowDownLeft, ShieldCheck } from 'lucide-react'

import type { ServiceFormState } from './use-service-form'

export function ServiceFormAside({ baseline, kind }: Pick<ServiceFormState, 'baseline' | 'kind'>) {
  return (
    <aside className="form-aside [padding:16px_0] [align-self:start] [position:sticky] [top:24px] [&_h3]:[font-size:15px] [&_h3]:[font-weight:450] [&_h3]:[line-height:1.6] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:11px] [&_p]:[line-height:1.9] [&_p]:[margin-top:12px] [&_h4]:[font-size:11px] [&_h4]:[color:light-dark(#27272a,_#c3c3ca)] max-[1100px]:[position:static]">
      <span className="service-icon mb-5 [flex-shrink:0] [display:grid] [place-items:center] [width:39px] [height:40px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:8px] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)]">
        <ArrowDownLeft size={22} />
      </span>
      <h3>{baseline ? 'Configure your service.' : 'A specification, then a deployment.'}</h3>
      <p>
        {baseline
          ? 'Changes apply to future builds. Existing builds and image revisions keep their recorded configuration. Saving does not start a build or deploy a workload.'
          : 'Create your service, save its secrets in OpenBao, and start its first build.'}
      </p>
      <div className="aside-divider [border-top:1px_solid_light-dark(#e4e4e7,_#28282c)] [margin:25px_0]" />
      <h4>What happens next?</h4>
      <p>
        {kind === 'oci-service'
          ? 'The build pipeline will turn this source and Dockerfile into an immutable OCI image before scheduling instances.'
          : 'A dedicated deployment runner will validate Wrangler, deploy the application, and coordinate its fleet.'}
      </p>
      <div className="aside-divider [border-top:1px_solid_light-dark(#e4e4e7,_#28282c)] [margin:25px_0]" />
      <span className="flex gap-2 text-xs text-muted">
        <ShieldCheck size={15} className="shrink-0" />
        Secrets stay out of images and build logs.
      </span>
    </aside>
  )
}
