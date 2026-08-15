import { useMemo, useState } from 'react'
import { Building2, ChevronRight, Globe2, MapPin, Radar, Search, Star } from 'lucide-react'
import { businesses, categories, locations } from '../data/businesses'
import { useDemo } from '../hooks/useDemo'
import { Badge, Button, Loading } from '../components/ui'

export function DiscoverView() {
  const demo = useDemo()
  const [category, setCategory] = useState<string>('All categories')
  const [location, setLocation] = useState('All Chennai')
  const filtered = useMemo(() => businesses.filter(item => (category === 'All categories' || item.category === category) && (location === 'All Chennai' || item.location.includes(location))), [category, location])

  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">01 · BUSINESS DISCOVERY</span><h1>Find businesses ready for a digital presence</h1><p>Explore fictional Chennai-area listings using local demo data.</p></div><div className="heading-stat"><span>10</span><small>Demo listings</small></div></div>
    <section className="filter-bar" aria-label="Business search filters">
      <label><span>Category</span><select value={category} onChange={e => setCategory(e.target.value)}><option>All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Location</span><select value={location} onChange={e => setLocation(e.target.value)}>{locations.map(item => <option key={item}>{item}</option>)}</select></label>
      <Button onClick={demo.scan} disabled={demo.scanning}>{demo.scanning ? <Loading label="Scanning…"/> : <><Radar size={17}/>Scan businesses</>}</Button>
      <span className="source-note"><Globe2 size={15}/>Simulated public listing data</span>
    </section>
    <div className="discovery-grid">
      <section className="map-card" aria-label="Demo map">
        <div className="section-head"><div><span className="eyebrow">LOCAL SCHEMATIC</span><h2>Demo map</h2></div><Badge tone="neutral">Not Google Maps</Badge></div>
        <div className="demo-map">
          <span className="road road-a"/><span className="road road-b"/><span className="road road-c"/><span className="road road-d"/>
          <span className="map-water">BAY OF BENGAL</span>
          {['AMBATTUR','ANNA NAGAR','T. NAGAR','GUINDY','PERUNGUDI','OMR'].map((label, index) => <span key={label} className={`map-label map-label-${index}`}>{label}</span>)}
          {filtered.map(item => <button key={item.id} className={`map-marker ${item.id === 'kumar' ? 'recommended' : ''}`} style={{ left: `${item.marker.x}%`, top: `${item.marker.y}%` }} onClick={() => { demo.goTo(2, true) }} aria-label={`View ${item.name}`}><MapPin size={item.id === 'kumar' ? 23 : 19} fill="currentColor"/></button>)}
          <div className="map-legend"><span><i className="legend-dot teal"/>High opportunity</span><span><i className="legend-dot grey"/>Demo business</span></div>
        </div>
      </section>
      <section className="results-card">
        <div className="section-head"><div><span className="eyebrow">DISCOVERY RESULTS</span><h2>{demo.scanned ? `${filtered.length} businesses found` : 'Ready to scan'}</h2></div>{demo.scanned && <Badge tone="green">Scan complete</Badge>}</div>
        {!demo.scanned ? <div className="results-placeholder"><div className="scan-rings"><Search size={24}/></div><strong>Set your filters and scan</strong><p>Results come from fixtures bundled with this concept demo.</p><Button variant="secondary" onClick={demo.scan}>Scan all Chennai</Button></div> : <div className="result-list">
          {filtered.map((item, index) => <article className={`business-row ${item.id === 'kumar' ? 'featured' : ''}`} key={item.id}>
            <div className="business-icon"><Building2 size={19}/></div>
            <div className="business-main"><div><strong>{item.name}</strong>{item.id === 'kumar' && <Badge tone="teal">Recommended lead</Badge>}</div><span>{item.category} · {item.location}</span><small>{item.contact} · Fictional demo contact</small></div>
            <div className="business-rating"><span><Star size={14} fill="currentColor"/>{item.rating}</span><small>{item.reviews} reviews</small></div>
            <div className="business-status"><Badge tone="amber">{item.website}</Badge><span><strong>{item.score}</strong>/100</span></div>
            <Button variant="ghost" aria-label={`View ${item.name}`} onClick={() => demo.goTo(2, true)}>View business <ChevronRight size={15}/></Button>
            {index === 0 && item.id === 'kumar' && <span className="row-accent"/>}
          </article>)}
        </div>}
      </section>
    </div>
  </div>
}
