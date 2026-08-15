import { AlertCircle, Building2, Check, ChevronRight, Globe, MapPin, Phone, ShieldCheck, Sparkles } from 'lucide-react'
import { useDemo } from '../hooks/useDemo'
import { Badge, Button } from '../components/ui'

const scoreRows = [['No website', 35], ['Valid business contact', 20], ['Physical location', 15], ['Positive customer activity', 15], ['Suitable service category', 15]] as const

export function QualifyView() {
  const demo = useDemo()
  return <div className="view-stack qualify-view">
    <div className="page-heading"><div><span className="eyebrow">02 · LEAD QUALIFICATION</span><h1>Review the recommended opportunity</h1><p>Rule-based scoring provides a transparent reason to proceed.</p></div><Badge tone="amber"><AlertCircle size={14}/>Approval checkpoint</Badge></div>
    <div className="two-column-main">
      <section className="surface lead-profile">
        <div className="profile-head"><div className="profile-avatar">KE</div><div><div className="title-line"><h2>Kumar Engineering Works</h2><Badge tone="teal">Recommended lead</Badge></div><p>Manufacturing & fabrication</p></div></div>
        <div className="profile-details"><div><MapPin size={17}/><span><small>LOCATION</small>Ambattur Industrial Estate, Chennai</span></div><div><Phone size={17}/><span><small>DEMO CONTACT</small>+91 90000 00004</span></div><div><Globe size={17}/><span><small>DIGITAL PRESENCE</small>No official website detected</span></div><div><Building2 size={17}/><span><small>DATA SOURCE</small>Simulated public business listing</span></div></div>
        <div className="evidence-block"><h3>Qualification evidence</h3><div className="evidence-grid">
          <div><Check/><span><strong>No official website</strong><small>Only a basic listing is simulated</small></span></div>
          <div><Check/><span><strong>Strong customer reviews</strong><small>4.4 rating from 38 demo reviews</small></span></div>
          <div><AlertCircle/><span><strong>Incomplete service information</strong><small>Exact capabilities require owner input</small></span></div>
          <div><Sparkles/><span><strong>High website opportunity</strong><small>Visual services suit enquiry capture</small></span></div>
        </div></div>
        <div className="solution-box"><span className="solution-icon"><Sparkles size={18}/></span><div><small>SUGGESTED SOLUTION</small><strong>Five-page industrial capability website</strong><p>Service pages, WhatsApp enquiry and customer drawing upload.</p></div><div className="value-estimate"><small>EST. VALUE</small><strong>₹15k–₹18k</strong></div></div>
      </section>
      <aside className="surface score-card">
        <div className="section-head"><div><span className="eyebrow">SIMULATED RULE-BASED SCORE</span><h2>Opportunity score</h2></div><ShieldCheck size={21}/></div>
        <div className="score-ring"><div><strong>100</strong><span>/100</span><small>HIGH OPPORTUNITY</small></div></div>
        <div className="score-rows">{scoreRows.map(([label, score]) => <div key={label}><span><Check size={14}/>{label}</span><strong>+{score}</strong></div>)}<div className="score-total"><span>Total score</span><strong>100 / 100</strong></div></div>
        <p className="disclaimer"><AlertCircle size={15}/>This is a transparent demo calculation—not an AI prediction or real-world business assessment.</p>
        <Button className="full-button" onClick={demo.approveOutreach}><ShieldCheck size={17}/>{demo.outreachApproved ? 'Outreach approved' : 'Approve outreach'}<ChevronRight size={16}/></Button>
        <small className="checkpoint-note">Stage 3 stays locked until human approval.</small>
      </aside>
    </div>
  </div>
}
