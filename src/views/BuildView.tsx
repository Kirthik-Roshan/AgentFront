import { Bot, Check, CheckCircle2, ChevronRight, Circle, Code2, Eye, Laptop, LoaderCircle, LockKeyhole, Monitor, Pause, Play, ShieldCheck, Smartphone, Sparkles } from 'lucide-react'
import { buildSteps, qaChecks } from '../data/buildSteps'
import { useDemo } from '../hooks/useDemo'
import { Badge, Button } from '../components/ui'
import { GeneratedSite } from '../components/GeneratedSite'
import { useState } from 'react'

export function BuildView() {
  const demo = useDemo()
  const [mobile, setMobile] = useState(false)
  if (demo.sitePreview) return <div className="site-preview-view">
    <div className="preview-toolbar"><div><Button variant="ghost" onClick={() => demo.setSitePreview(false)}>← Build workflow</Button><span className="preview-address"><LockKeyhole size={14}/>preview.agentfront.local/kumar-engineering</span></div><div className="device-controls"><button className={!mobile ? 'active' : ''} onClick={() => setMobile(false)} aria-label="Desktop preview"><Monitor size={17}/>Desktop</button><button className={mobile ? 'active' : ''} onClick={() => setMobile(true)} aria-label="Mobile preview"><Smartphone size={17}/>Mobile</button></div><Badge tone="amber">Private preview</Badge></div>
    <div className={`preview-canvas ${mobile ? 'mobile-canvas' : ''}`}><GeneratedSite mobile={mobile}/></div>
  </div>

  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">06 · SIMULATED WEBSITE BUILD</span><h1>Specialised agents, visible checkpoints</h1><p>Every activity is a deterministic local simulation; publishing still requires approval.</p></div>{demo.buildComplete ? <Badge tone="green"><CheckCircle2 size={14}/>Build complete</Badge> : <Badge tone="blue"><Bot size={14}/>6 specialised agents</Badge>}</div>
    <div className="build-overview"><section className="surface workflow-panel">
      <div className="section-head"><div><span className="eyebrow">AGENT WORKFLOW</span><h2>Website production</h2></div><div className="build-controls">{!demo.buildStarted && <Button onClick={demo.startBuild}><Play size={16}/>Start build</Button>}{demo.buildStarted && !demo.buildComplete && <Button variant="secondary" onClick={demo.paused ? demo.resume : demo.pause}>{demo.paused ? <Play size={15}/> : <Pause size={15}/>}{demo.paused ? 'Continue' : 'Pause'}</Button>}<Button variant="ghost" onClick={demo.skipBuild}>Skip build animation</Button></div></div>
      <div className="agent-list">{buildSteps.map((step, index) => {
        const complete = demo.buildComplete || index < demo.buildIndex
        const working = demo.buildStarted && !demo.buildComplete && index === demo.buildIndex
        return <article key={step.name} className={`agent-row ${complete ? 'agent-complete' : working ? 'agent-working' : ''}`}><span className="agent-status-icon">{complete ? <Check/> : working ? <LoaderCircle className="spin"/> : <Circle/>}</span><div><strong>{step.name}</strong><span>{complete ? step.description : working ? step.description : 'Waiting for previous approval or output'}</span></div><Badge tone={complete ? 'green' : working ? 'blue' : 'neutral'}>{complete ? 'Completed' : working ? 'Working' : 'Waiting'}</Badge>{index < buildSteps.length - 1 && <span className="agent-connector"/>}</article>
      })}</div>
      {demo.buildStarted && <div className="activity-log"><span><Code2 size={15}/>LIVE ACTIVITY</span><p><i/>{demo.buildComplete ? 'Build package prepared. Awaiting human preview approval.' : buildSteps[Math.max(0, demo.buildIndex)]?.description}</p></div>}
    </section>
    <aside className="surface qa-panel"><div className="section-head"><div><span className="eyebrow">QUALITY ASSURANCE</span><h2>Release checks</h2></div><ShieldCheck size={21}/></div><div className="qa-score"><div><strong>{demo.buildComplete ? '7/7' : `${Math.max(0, demo.buildIndex)}/7`}</strong><span>checks passed</span></div><div className="progress-track"><span style={{ width: `${demo.buildComplete ? 100 : Math.max(0, demo.buildIndex) / 7 * 100}%` }}/></div></div><ul className="qa-list">{qaChecks.map((check, index) => <li key={check} className={demo.buildComplete || index < demo.buildIndex ? 'passed' : ''}>{demo.buildComplete || index < demo.buildIndex ? <Check/> : <Circle/>}{check}</li>)}</ul><div className="approval-gate"><LockKeyhole/><div><strong>Human release gate</strong><span>Preview must be reviewed before deployment.</span></div></div><Button className="full-button" disabled={!demo.buildComplete} onClick={() => demo.setSitePreview(true)}><Eye size={17}/>Open generated website<ChevronRight size={16}/></Button></aside></div>
    {demo.buildComplete && <section className="preview-teaser"><div className="teaser-browser"><div><i/><i/><i/><span>kumar-engineering.agentfront.demo</span></div><img src="/demo-assets/laser-cutting.png" alt="Generated website preview"/><span className="teaser-overlay"><Sparkles/><strong>Client website ready</strong><small>Desktop and mobile previews available</small></span></div><div><span className="eyebrow">GENERATED CLIENT WEBSITE</span><h2>Precision Metal Fabrication in Chennai</h2><p>A complete bilingual-ready site with services, capabilities, enquiry capture and drawing upload.</p><div className="teaser-points"><span><Laptop/>Responsive layout</span><span><ShieldCheck/>Owner-verified content</span></div><Button onClick={() => demo.setSitePreview(true)}><Eye size={16}/>Review website</Button><Button variant="secondary" onClick={() => demo.goTo(7)}>Proceed to delivery <ChevronRight size={16}/></Button></div></section>}
  </div>
}
