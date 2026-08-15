import { Bot, Info, LockKeyhole, ShieldCheck } from 'lucide-react'
import { outreachMessages } from '../data/conversations'
import { useDemo } from '../hooks/useDemo'
import { Conversation } from '../components/Conversation'
import { Badge } from '../components/ui'

export function OutreachView() {
  const demo = useDemo()
  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">03 · CONSENT-FIRST OUTREACH</span><h1>Introduce the service transparently</h1><p>The simulated agent identifies itself and requests permission before discovery.</p></div><Badge tone="green"><ShieldCheck size={14}/>Human approved</Badge></div>
    <div className="chat-layout"><Conversation messages={outreachMessages} visible={demo.outreachIndex} onNext={demo.nextOutreach} onComplete={demo.completeOutreach} completeLabel="Collect requirements" />
      <aside className="conversation-aside"><section className="surface"><span className="eyebrow">CONVERSATION POLICY</span><h3>Guardrails active</h3><ul className="check-list"><li><ShieldCheck/>Human outreach approval recorded</li><li><Bot/>AI identity stated in first message</li><li><LockKeyhole/>Private concept only</li><li><Info/>No real message is being sent</li></ul></section><section className="consent-card"><div><ShieldCheck size={19}/><strong>Owner consent</strong></div><p>Permission to discuss the concept was recorded at 10:03.</p><Badge tone={demo.outreachIndex >= 3 ? 'green' : 'amber'}>{demo.outreachIndex >= 3 ? 'Granted' : 'Awaiting message'}</Badge></section></aside>
    </div>
  </div>
}
