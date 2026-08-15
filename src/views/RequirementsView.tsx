import { Check, CheckCircle2, CircleAlert, ClipboardCheck, Languages, Mic, Play } from 'lucide-react'
import { useState } from 'react'
import { Conversation } from '../components/Conversation'
import { Badge, Button } from '../components/ui'
import { requirementFields, requirementMessages } from '../data/conversations'
import { useDemo } from '../hooks/useDemo'

export function RequirementsView() {
  const demo = useDemo()
  const [playing, setPlaying] = useState(false)
  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">04 · REQUIREMENT COLLECTION</span><h1>Turn conversation into a verified brief</h1><p>The brief updates only as owner messages appear.</p></div><Badge tone="blue"><Languages size={14}/>Tamil + English</Badge></div>
    <div className="requirements-layout">
      <div className="requirements-chat"><Conversation messages={requirementMessages} visible={demo.requirementsIndex} onNext={demo.nextRequirement} title="Requirements session" subtitle="Simulated assisted conversation" />
        <section className="voice-note">
          <button onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause voice note' : 'Play voice note'}><Play size={17} fill="currentColor"/></button>
          <div className={`waveform ${playing ? 'wave-playing' : ''}`} aria-hidden="true">{[8,15,22,12,28,18,10,24,31,17,11,22,14,26,9,18,13,24,8].map((height, index) => <i key={index} style={{ height }}/>)}</div>
          <span>0:12</span><Badge tone="neutral"><Mic size={12}/>Simulated voice note</Badge>
          <div className="transcription"><small>TAMIL TRANSCRIPTION</small><p>“நாங்க laser cutting, bending, welding services பண்றோம். Customer drawing அனுப்பணும்.”</p><span><Languages size={14}/><strong>English interpretation:</strong> We provide laser cutting, bending and welding. The customer needs to send a drawing.</span></div>
        </section>
      </div>
      <aside className="surface live-brief">
        <div className="section-head"><div><span className="eyebrow">LIVE REQUIREMENT BRIEF</span><h2>Website scope</h2></div><ClipboardCheck size={21}/></div>
        <div className="brief-progress"><div><span>Fields verified</span><strong>{requirementFields.filter(field => demo.requirementsIndex >= field[2]).length}/{requirementFields.length}</strong></div><div className="progress-track"><span style={{ width: `${requirementFields.filter(field => demo.requirementsIndex >= field[2]).length / requirementFields.length * 100}%` }}/></div></div>
        <div className="brief-fields">{requirementFields.map(([label, value, at]) => {
          const revealed = demo.requirementsIndex >= at
          const missing = demo.requirementsIndex < at - 1
          return <div key={label} className={!revealed ? 'brief-pending' : ''}><div><small>{label.toUpperCase()}</small><strong>{revealed ? value : missing ? 'Not collected yet' : value}</strong></div><Badge tone={revealed ? 'green' : missing ? 'red' : 'amber'}>{revealed ? <><Check size={12}/>Owner verified</> : missing ? <><CircleAlert size={12}/>Missing</> : 'Needs confirmation'}</Badge></div>
        })}</div>
        <Button className="full-button" disabled={demo.requirementsIndex < 5} onClick={demo.approveRequirements}><CheckCircle2 size={17}/>Owner approves requirements</Button>
        <small className="checkpoint-note">{demo.requirementsIndex < 5 ? 'Complete the conversation to enable approval.' : 'Approval unlocks controlled negotiation.'}</small>
      </aside>
    </div>
  </div>
}
