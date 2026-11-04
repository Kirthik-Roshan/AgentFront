import { useState, type CSSProperties } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Monitor,
  MousePointer2,
  RefreshCw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import './TemplateLibrary.css';

type TemplateSlug = 'restaurant' | 'salon' | 'garments' | 'mechanic' | 'clinic' | 'education' | 'realestate' | 'fitness' | 'bakery' | 'legal' | 'spa' | 'dental' | 'physiotherapy' | 'petcare' | 'catering' | 'events' | 'photography' | 'interiors' | 'travel' | 'movers' | 'appliance' | 'trades' | 'detailing' | 'drivingschool' | 'laundry' | 'furniture' | 'devicerepair' | 'printing' | 'florist' | 'jewellery' | 'tailoring' | 'cloudkitchen';
type PreviewViewport = 'desktop' | 'mobile';

type TemplateDefinition = {
  slug: TemplateSlug;
  category: string;
  name: string;
  description: string;
  capabilities: string[];
  accent: string;
};

const templateCatalog: TemplateDefinition[] = [
  {
    slug: 'restaurant',
    category: 'Restaurant',
    name: 'Ember & Leaf',
    description: 'Editorial dining experience with menu, gallery, reservations and direct-ordering foundations.',
    capabilities: ['Menu', 'Reservations', 'WhatsApp'],
    accent: '#d86532',
  },
  {
    slug: 'salon',
    category: 'Salon & beauty',
    name: 'Studio Muse',
    description: 'Calm premium service showcase with pricing, team profiles, social proof and booking journeys.',
    capabilities: ['Services', 'Pricing', 'Booking'],
    accent: '#b98b7f',
  },
  {
    slug: 'garments',
    category: 'Garments',
    name: 'Loom & Line',
    description: 'Fashion-led storefront for seasonal collections, catalogue discovery and customer enquiries.',
    capabilities: ['Collections', 'Catalogue', 'Enquiry'],
    accent: '#b78a4b',
  },
  {
    slug: 'mechanic',
    category: 'Mechanic workshop',
    name: 'Northline Auto Care',
    description: 'High-energy workshop experience with service triage, packages and urgent contact actions.',
    capabilities: ['Triage', 'Services', 'Emergency'],
    accent: '#f4ad32',
  },
  { slug: 'clinic', category: 'Clinic & healthcare', name: 'Asterwell Clinic', description: 'Patient-first healthcare experience with services, doctors, trust signals and appointment journeys.', capabilities: ['Services', 'Doctors', 'Appointments'], accent: '#168f7b' },
  { slug: 'education', category: 'Education & training', name: 'Northstar Academy', description: 'Energetic academy experience for programmes, mentors, outcomes and admissions enquiries.', capabilities: ['Programmes', 'Mentors', 'Admissions'], accent: '#6558e8' },
  { slug: 'realestate', category: 'Real estate', name: 'Terra & Key', description: 'Cinematic property showcase for curated listings, private visits and qualified buyer enquiries.', capabilities: ['Listings', 'Viewings', 'Advisory'], accent: '#a55f35' },
  { slug: 'fitness', category: 'Gym & fitness', name: 'Form & Fire', description: 'High-energy coaching experience for classes, memberships and trial-session conversion.', capabilities: ['Classes', 'Coaches', 'Trial booking'], accent: '#ef634d' },
  { slug: 'bakery', category: 'Bakery & cakes', name: 'Butter & Bloom', description: 'Warm artisan storefront for the daily bake, celebration orders and pickup enquiries.', capabilities: ['Bake list', 'Pre-orders', 'Celebrations'], accent: '#b94935' },
  { slug: 'legal', category: 'Legal services', name: 'Meridian Counsel', description: 'Discreet professional practice for expertise, trust signals and consultation intake.', capabilities: ['Practice areas', 'Advisory', 'Consultations'], accent: '#7d2838' },
  { slug: 'spa', category: 'Spa & wellness', name: 'Serein House', description: 'Restorative rituals, treatments and frictionless booking.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#b77a86' },
  { slug: 'dental', category: 'Dental clinic', name: 'Ivory Dental', description: 'Calm modern dentistry with appointments and trust signals.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#278a9b' },
  { slug: 'physiotherapy', category: 'Physiotherapy', name: 'Kinetic Care', description: 'Movement-led recovery with programmes and assessments.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#e05b3f' },
  { slug: 'petcare', category: 'Pet care & vet', name: 'Goodfolk Pets', description: 'Veterinary care and grooming with warm local personality.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#e07c45' },
  { slug: 'catering', category: 'Catering', name: 'Gather & Grain', description: 'Celebration menus and event enquiries with culinary theatre.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#b85031' },
  { slug: 'events', category: 'Events & weddings', name: 'Afterglow Studio', description: 'Cinematic planning portfolio for meaningful celebrations.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#c94766' },
  { slug: 'photography', category: 'Photography', name: 'Still & Story', description: 'Editorial visual stories, packages and session enquiries.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#c66b42' },
  { slug: 'interiors', category: 'Interior design', name: 'Form Habitat', description: 'Architectural portfolio for spaces, process and consultations.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#8f653e' },
  { slug: 'travel', category: 'Travel agency', name: 'Elsewhere Co.', description: 'Immersive journeys, itineraries and planning enquiries.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#167c8b' },
  { slug: 'movers', category: 'Packers & movers', name: 'ShiftWorks', description: 'Clear relocation services, trust proof and quote requests.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#df5c2f' },
  { slug: 'appliance', category: 'Appliance repair', name: 'CoolFix Works', description: 'Fast service discovery and doorstep repair booking.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#177fc4' },
  { slug: 'trades', category: 'Electrical & plumbing', name: 'Local Current', description: 'Urgent local services with transparent estimates.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#dc9b1f' },
  { slug: 'detailing', category: 'Car detailing', name: 'Gloss District', description: 'High-energy packages for wash, correction and protection.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#29a7d8' },
  { slug: 'drivingschool', category: 'Driving school', name: 'Good Turn', description: 'Friendly course discovery and lesson booking.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#ef7042' },
  { slug: 'laundry', category: 'Laundry & dry clean', name: 'Fold Society', description: 'Doorstep garment care with pickup conversion.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#4178b8' },
  { slug: 'furniture', category: 'Furniture & decor', name: 'Common Form', description: 'Editorial catalogue for crafted objects and enquiries.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#9a6540' },
  { slug: 'devicerepair', category: 'Device repair', name: 'Circuit House', description: 'Clear diagnostics, repair services and rapid contact.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#6558e8' },
  { slug: 'printing', category: 'Print & signage', name: 'Boldmark', description: 'Expressive production capabilities and quote requests.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#ef4e37' },
  { slug: 'florist', category: 'Flowers & gifts', name: 'Wild Stem', description: 'Seasonal bouquets, gifting and occasion orders.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#c65b76' },
  { slug: 'jewellery', category: 'Fine jewellery', name: 'Aurum Atelier', description: 'Luxury collections, bespoke craft and appointments.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#a97822' },
  { slug: 'tailoring', category: 'Tailoring boutique', name: 'Cut & Kin', description: 'Fashion-led custom work, fittings and consultations.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#973f59' },
  { slug: 'cloudkitchen', category: 'Cloud kitchen', name: 'Nightjar Kitchen', description: 'Delivery-first menu discovery and direct ordering.', capabilities: ['Services', 'Gallery', 'Enquiry'], accent: '#dc4d2f' },
];

export function TemplateLibrary() {
  const [activeSlug, setActiveSlug] = useState<TemplateSlug>('restaurant');
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [revision, setRevision] = useState(0);
  const activeTemplate = templateCatalog.find((template) => template.slug === activeSlug) ?? templateCatalog[0]!;
  const previewUrl = `/templates/${activeTemplate.slug}/index.html`;

  return (
    <div className="page template-library-page">
      <header className="template-library-heading">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Production foundations</p>
          <h1>Template library</h1>
          <p>Thirty-two interactive, responsive sites ready for bounded client-specific content and theme changes.</p>
        </div>
        <div className="template-library-heading__stat">
          <span>Available now</span>
          <strong>{templateCatalog.length}</strong>
          <small>Canonical templates</small>
        </div>
      </header>

      <section className="template-library-grid" aria-label="Website templates">
        {templateCatalog.map((template, index) => {
          const selected = template.slug === activeTemplate.slug;
          return (
            <button
              className={`template-library-card${selected ? ' is-selected' : ''}`}
              type="button"
              key={template.slug}
              onClick={() => setActiveSlug(template.slug)}
              aria-pressed={selected}
              style={{ '--template-accent': template.accent } as CSSProperties}
            >
              <span className="template-library-card__visual">
                <img src={`/templates/${template.slug}/assets/hero.png`} alt="" />
                <span className="template-library-card__index">0{index + 1}</span>
                <span className="template-library-card__status">
                  {selected ? <CheckCircle2 size={13} /> : <MousePointer2 size={13} />}
                  {selected ? 'Previewing' : 'Select'}
                </span>
              </span>
              <span className="template-library-card__copy">
                <span>{template.category}</span>
                <strong>{template.name}</strong>
                <small>{template.description}</small>
                <span className="template-library-card__tags">
                  {template.capabilities.map((capability) => <em key={capability}>{capability}</em>)}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="template-browser panel" aria-labelledby="template-preview-title">
        <div className="template-browser__toolbar">
          <div className="template-browser__identity">
            <span className="template-browser__dots"><i /><i /><i /></span>
            <span>
              <small>Live template preview</small>
              <strong id="template-preview-title">{activeTemplate.category} · {activeTemplate.name}</strong>
            </span>
          </div>
          <code>{previewUrl}</code>
          <div className="template-browser__actions">
            <span className="template-browser__viewport" aria-label="Preview viewport">
              <button className={viewport === 'desktop' ? 'is-active' : ''} type="button" onClick={() => setViewport('desktop')} aria-label="Desktop preview"><Monitor size={15} /></button>
              <button className={viewport === 'mobile' ? 'is-active' : ''} type="button" onClick={() => setViewport('mobile')} aria-label="Mobile preview"><Smartphone size={15} /></button>
            </span>
            <button type="button" onClick={() => setRevision((value) => value + 1)} aria-label="Reload preview"><RefreshCw size={15} /></button>
            <button type="button" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={15} /><span>Open full preview</span></button>
          </div>
        </div>
        <div className={`template-browser__stage is-${viewport}`}>
          <div className="template-browser__device">
            <iframe
              key={`${activeTemplate.slug}-${revision}`}
              src={previewUrl}
              title={`${activeTemplate.category} template interactive preview`}
              loading="eager"
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
            />
          </div>
        </div>
        <footer className="template-browser__footer">
          <span><i /> Interactive preview</span>
          <p>The Developer Agent starts here and changes only approved business content, branding and enabled features.</p>
        </footer>
      </section>
    </div>
  );
}
