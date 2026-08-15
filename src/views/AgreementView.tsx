import { ArrowDown, Check, CheckCircle2, Clock, FileCheck2, IndianRupee, LockKeyhole, ShieldAlert, UserCheck } from 'lucide-react'
import { useDemo } from '../hooks/useDemo'
import { Badge, Button } from '../components/ui'

export function AgreementView() {
  const demo = useDemo()
  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">05 · CONTROLLED AGREEMENT</span><h1>Negotiate within human-approved limits</h1><p>The simulated agent recommends a midpoint but cannot approve the final offer.</p></div><Badge tone="amber"><ShieldAlert size={14}/>Human decision required</Badge></div>
    <div className="agreement-grid">
      <section className="surface negotiation-card">
        <div className="section-head"><div><span className="eyebrow">PRICE NEGOTIATION</span><h2>Proposal timeline</h2></div><Badge tone="neutral">Simulated</Badge></div>
        <div className="price-timeline">
          <div className="price-step"><span className="price-person agent-person">AF</span><div><small>INITIAL PROPOSAL · SALES AGENT</small><strong>₹18,000</strong><p>Five-page website, enquiry form, drawing upload and maintenance.</p></div><Badge tone="blue">Proposed</Badge></div>
          <ArrowDown className="timeline-arrow" size={18}/>
          <div className="price-step"><span className="price-person owner-person">K</span><div><small>OWNER BUDGET</small><strong>₹12,000</strong><p>“Can we keep the complete project closer to this amount?”</p></div><Badge tone="neutral">Countered</Badge></div>
          <ArrowDown className="timeline-arrow" size={18}/>
          <div className="price-step recommended-price"><span className="price-person recommendation-person"><IndianRupee size={17}/></span><div><small>AGENT RECOMMENDATION</small><strong>₹15,000</strong><p>Balanced scope and budget. Requires supervisor approval.</p></div><Badge tone="amber">Awaiting approval</Badge></div>
        </div>
        {!demo.offerApproved ? <div className="approval-callout"><ShieldAlert size={22}/><div><strong>Human approval required: ₹15,000 final proposal.</strong><p>The AI agent cannot independently accept or communicate the final price.</p></div><Button onClick={demo.approveOffer}><UserCheck size={16}/>Approve offer</Button></div> : <div className="approval-callout approved"><CheckCircle2 size={22}/><div><strong>₹15,000 offer approved by Human Supervisor</strong><p>Approval logged today at 10:16. Ready for owner acceptance.</p></div><Badge tone="green">Approved</Badge></div>}
        <Button className="full-button" disabled={!demo.offerApproved} onClick={demo.acceptOffer}><Check size={17}/>Simulate owner acceptance</Button>
      </section>
      <aside className="surface project-summary">
        <div className="summary-heading"><FileCheck2 size={21}/><div><span className="eyebrow">PROJECT SUMMARY</span><h2>Kumar Engineering</h2></div></div>
        <div className="deal-price"><small>FINAL PROJECT VALUE</small><strong>{demo.offerApproved ? '₹15,000' : 'Pending approval'}</strong></div>
        <dl><div><dt>Advance (30%)</dt><dd>₹4,500</dd></div><div><dt>Delivery period</dt><dd><Clock size={14}/>Seven days</dd></div><div><dt>Maintenance</dt><dd>Three months</dd></div><div><dt>Scope</dt><dd>5 pages + enquiry + upload</dd></div><div><dt>Approval history</dt><dd>{demo.offerApproved ? 'Human approved' : 'Awaiting human'}</dd></div></dl>
        <div className="deal-status"><span className={demo.dealClosed ? 'status-pulse' : 'status-pulse amber-pulse'}/><div><small>DEAL STATUS</small><strong>{demo.dealClosed ? 'Closed' : demo.offerApproved ? 'Owner acceptance pending' : 'Negotiating'}</strong></div><Badge tone={demo.dealClosed ? 'green' : 'amber'}>{demo.dealClosed ? 'Closed' : 'Open'}</Badge></div>
        <p className="disclaimer"><LockKeyhole size={15}/>No real contract, invoice or payment is created.</p>
      </aside>
    </div>
  </div>
}
