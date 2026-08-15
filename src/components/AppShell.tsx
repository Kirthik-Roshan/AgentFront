import { useState, type ReactNode } from 'react'
import { Check, ChevronRight, CircleHelp, Clock3, Menu, PanelRightOpen, Pause, Play, RefreshCw, SkipForward, X, Zap } from 'lucide-react'
import { useDemo } from '../hooks/useDemo'
import type { StageId } from '../types'
import { Badge, Button, StageState } from './ui'

const stages = [
  ['Discover', 'Find eligible businesses'], ['Qualify', 'Review opportunity'], ['Outreach', 'Request permission'], ['Requirements', 'Verify the brief'],
  ['Agreement', 'Approve commercial terms'], ['Build', 'Create and test'], ['Deliver', 'Approve and maintain']
] as const

const story = [
  'We begin with simulated public listings and clearly identify businesses without a proper website.',
  'A transparent rule-based score prioritises a strong, contactable local business.',
  'Outreach only begins after human approval, and the assistant identifies itself immediately.',
  'Every requirement is traced back to owner-confirmed conversation details.',
  'Price limits are controlled by a human; the agent cannot accept the final amount.',
  'Specialised agents simulate work while approvals prevent uncontrolled publishing.',
  'The owner approves delivery and can request traceable maintenance updates.'
]

export function AppShell({ children }: { children: ReactNode }) {
  const demo = useDemo()
  const [panel, setPanel] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [showStory, setShowStory] = useState(false)
  const completed = demo.maintenanceStep >= 4 ? 7 : Math.max(0, demo.unlocked - 1)

  const jump = (stage: StageId) => { demo.goTo(stage, true); setPanel(false); setMobileNav(false) }
  const openWebsite = () => { demo.goTo(6, true); demo.setSitePreview(true); setPanel(false); setMobileNav(false) }
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Zap size={18} fill="currentColor" /></div><div><strong>AgentFront</strong><span>Agency operations</span></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <nav aria-label="Demo stages">
        <p className="nav-label">DELIVERY PIPELINE</p>
        {stages.map(([label, subtitle], index) => {
          const id = (index + 1) as StageId
          const locked = id > demo.unlocked
          return <button key={label} className={`nav-stage ${demo.stage === id ? 'active' : ''}`} disabled={locked} onClick={() => jump(id)}>
            <span className="stage-number"><StageState locked={locked} complete={id < demo.unlocked || (id === 7 && demo.maintenanceStep >= 4)} /></span>
            <span><strong>{label}</strong><small>{subtitle}</small></span>
            {!locked && demo.stage === id && <ChevronRight size={15}/>} 
          </button>
        })}
      </nav>
      <div className="sidebar-progress"><div><span>Demo progress</span><strong>{completed}/7</strong></div><div className="progress-track"><span style={{ width: `${(completed / 7) * 100}%` }}/></div><small>{completed === 7 ? 'Journey complete' : `${7 - completed} stages remaining`}</small></div>
      <div className="sidebar-foot"><span className="status-pulse"/> Simulation environment <Badge tone="neutral">v1.0</Badge></div>
    </aside>
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <div className="app-main">
      <div className="demo-banner"><span>Interactive concept demo</span> — business data and agent actions are simulated.</div>
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19}/></button><div><span className="eyebrow">CURRENT WORKSPACE</span><strong>{stages[demo.stage - 1][0]}</strong></div></div>
        <div className="topbar-actions">
          <Badge tone={demo.mode === 'guided' ? 'teal' : 'neutral'}>{demo.mode === 'guided' ? 'Guided Demo' : 'Manual Mode'}</Badge>
          {demo.mode === 'guided' && <span className="timer"><Clock3 size={15}/>{Math.floor(demo.elapsedSeconds / 60)}:{String(demo.elapsedSeconds % 60).padStart(2, '0')}</span>}
          {demo.mode === 'guided' && (demo.paused ? <Button variant="secondary" onClick={demo.resume}><Play size={15}/>Continue</Button> : <Button variant="secondary" onClick={demo.pause}><Pause size={15}/>Pause</Button>)}
          <Button variant="ghost" onClick={demo.skipAnimation} title="Complete the current animation"><SkipForward size={16}/><span className="desktop-only">Skip animation</span></Button>
          <button className="icon-button" onClick={() => setShowStory(!showStory)} aria-label="Demo story" title="Demo story"><CircleHelp size={19}/></button>
          <Button variant="secondary" onClick={() => setPanel(true)}><PanelRightOpen size={16}/><span className="desktop-only">Presenter panel</span></Button>
        </div>
        {showStory && <div className="story-popover"><div><strong>Demo story · {stages[demo.stage - 1][0]}</strong><button className="icon-button" onClick={() => setShowStory(false)}><X size={15}/></button></div><p>{story[demo.stage - 1]}</p></div>}
      </header>
      <main className="workspace">{children}</main>
    </div>
    {panel && <><button className="panel-scrim" onClick={() => setPanel(false)} aria-label="Close presenter panel"/><aside className="presenter-panel">
      <div className="panel-head"><div><span className="eyebrow">PRESENTATION CONTROL</span><h2>Presenter panel</h2></div><button className="icon-button" onClick={() => setPanel(false)} aria-label="Close presenter panel"><X size={19}/></button></div>
      <div className="presenter-status"><div className="presenter-icon"><Play size={19}/></div><div><strong>{demo.mode === 'guided' ? (demo.paused ? 'Guided demo paused' : 'Guided demo running') : 'Ready to present'}</strong><span>Current stage: {stages[demo.stage - 1][0]}</span></div></div>
      <Button className="full-button" onClick={() => { demo.startGuided(); setPanel(false) }}><Play size={16}/>Start guided demo</Button>
      <p className="nav-label panel-label">QUICK JUMPS</p>
      <div className="jump-list">
        <button onClick={() => jump(1)}><span>01</span>Discovery <ChevronRight size={15}/></button>
        <button onClick={() => jump(5)}><span>05</span>Negotiation <ChevronRight size={15}/></button>
        <button onClick={() => jump(6)}><span>06</span>Build workflow <ChevronRight size={15}/></button>
        <button onClick={openWebsite}><span><Check size={14}/></span>Generated website <ChevronRight size={15}/></button>
        <button onClick={() => jump(7)}><span>07</span>Deployment success <ChevronRight size={15}/></button>
      </div>
      <div className="panel-note"><CircleHelp size={17}/><p><strong>Presenter tip</strong>Use “Demo story” in the top bar for a concise narration prompt at every stage.</p></div>
      <Button variant="danger" className="full-button reset-button" onClick={() => { demo.reset(); setPanel(false) }}><RefreshCw size={16}/>Reset all demo data</Button>
    </aside></>}
  </div>
}
