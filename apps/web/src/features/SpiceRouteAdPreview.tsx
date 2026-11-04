import { useEffect, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, ExternalLink, Film, MapPin, Pause, Play, Search, Sparkles, VolumeX } from 'lucide-react';
import './SpiceRouteAdPreview.css';

type Platform = 'reels' | 'google';

type Props = {
  /** Pass only an independently verified deployment URL; known demo/local placeholders fall back to the bundled site. */
  siteUrl?: string;
};

const scenes = [
  { eyebrow: 'A little Chennai heat', title: 'Big flavour.\nRight around the corner.', detail: 'Discover SpiceRoute Kitchen in Sholinganallur.' },
  { eyebrow: 'From our kitchen', title: 'Find your\nnext favourite.', detail: 'Browse the menu before you visit.' },
  { eyebrow: 'Pull up a seat', title: 'Your table\nis waiting.', detail: 'Explore the site and get in touch directly.' },
];

const fallbackSite = '/generated-sites/AF-2026-000001/index.html';

function safeSiteUrl(value?: string): string {
  if (!value) return fallbackSite;
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return fallbackSite;
    if (url.origin === window.location.origin && url.pathname === fallbackSite) return fallbackSite;
    if (['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.demo.agentfront.local') || url.hostname.endsWith('.example')) return fallbackSite;
    return url.href;
  } catch {
    return fallbackSite;
  }
}

export function SpiceRouteAdPreview({ siteUrl }: Props) {
  const [platform, setPlatform] = useState<Platform>('reels');
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [motionAllowed, setMotionAllowed] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setMotionAllowed(!query.matches);
      if (query.matches) setPlaying(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!playing || !motionAllowed || platform !== 'reels') return;
    const timer = window.setInterval(() => setScene((current) => (current + 1) % scenes.length), 4700);
    return () => window.clearInterval(timer);
  }, [playing, motionAllowed, platform]);

  const destination = safeSiteUrl(siteUrl);
  const isBundledDemo = !siteUrl || destination === fallbackSite;
  const nextScene = (direction: -1 | 1) => setScene((current) => (current + direction + scenes.length) % scenes.length);
  const switchTab = (next: Platform) => {
    setPlatform(next);
    window.requestAnimationFrame(() => document.getElementById(`spice-tab-${next}`)?.focus());
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      switchTab(platform === 'reels' ? 'google' : 'reels');
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      switchTab(event.key === 'Home' ? 'reels' : 'google');
    }
  };

  return <section className="spice-ad panel" aria-labelledby="spice-ad-title">
    <div className="spice-ad__header">
      <div>
        <span className="spice-ad__kicker"><Sparkles size={15} /> SpiceRoute Kitchen · creative studio</span>
        <h2 id="spice-ad-title">What the campaign could look like.</h2>
        <p>Review an illustrative local ad creative for the finished website. These are visual previews, not a published campaign or proof of delivery.</p>
      </div>
      <span className="spice-ad__state"><span aria-hidden="true" /> Concept preview · not published</span>
    </div>

    <div className="spice-ad__tabs" role="tablist" aria-label="Ad format preview">
      <button type="button" role="tab" id="spice-tab-reels" aria-controls="spice-panel-reels" aria-selected={platform === 'reels'} tabIndex={platform === 'reels' ? 0 : -1} className={platform === 'reels' ? 'is-active' : ''} onClick={() => setPlatform('reels')} onKeyDown={onTabKeyDown}><Film size={17} /> Instagram Reels concept <span>9:16</span></button>
      <button type="button" role="tab" id="spice-tab-google" aria-controls="spice-panel-google" aria-selected={platform === 'google'} tabIndex={platform === 'google' ? 0 : -1} className={platform === 'google' ? 'is-active' : ''} onClick={() => setPlatform('google')} onKeyDown={onTabKeyDown}><Search size={17} /> Google + YouTube concept <span>Search · Video</span></button>
    </div>

    {platform === 'reels' ? <div id="spice-panel-reels" role="tabpanel" aria-labelledby="spice-tab-reels" className="spice-ad__stage spice-ad__stage--reels">
      <div className="spice-ad__phone-wrap">
        <div className={`spice-ad__phone${playing && motionAllowed ? ' is-playing' : ''}`}>
          <div className="spice-ad__phone-media" role="img" aria-label="Warm South Indian food on a restaurant table" />
          <div className="spice-ad__phone-shade" />
          <div className="spice-ad__phone-top"><span className="spice-ad__phone-dash" aria-hidden="true" /><span>Creative storyboard</span><VolumeX size={15} aria-label="No audio" /></div>
          <div className="spice-ad__phone-center" key={scene} aria-live={playing ? 'off' : 'polite'}>
            <span>{scenes[scene].eyebrow}</span>
            <strong>{scenes[scene].title}</strong>
            <p>{scenes[scene].detail}</p>
          </div>
          <div className="spice-ad__phone-bottom"><div className="spice-ad__phone-account"><span>S</span><strong>SpiceRoute Kitchen <small>Sponsored concept</small></strong></div><span className="spice-ad__phone-cta">Explore menu <ArrowUpRight size={15} /></span></div>
          <div className="spice-ad__scene-ticks" aria-hidden="true">{scenes.map((_, index) => <span key={index} className={index === scene ? 'is-active' : ''} />)}</div>
        </div>
      </div>
      <div className="spice-ad__notes">
        <div className="spice-ad__notes-top"><span className="spice-ad__number">01 / 02</span><span>Vertical storyboard</span></div>
        <h3>From the first craving to the first click.</h3>
        <p>Three short scenes introduce the restaurant, show the menu promise, and point people to the new website. The final Reel would need approved footage, music, account access and platform review.</p>
        <div className="spice-ad__chips"><span><MapPin size={14} /> Sholinganallur, Chennai</span><span>Local discovery</span><span>Menu CTA</span></div>
        <div className="spice-ad__controls" aria-label="Storyboard controls">
          <button type="button" onClick={() => nextScene(-1)} aria-label="Previous scene"><ChevronLeft size={19} /></button>
          <button type="button" onClick={() => setPlaying((current) => !current)} disabled={!motionAllowed} aria-label={!motionAllowed ? 'Automatic motion disabled by reduced-motion preference' : playing ? 'Pause storyboard' : 'Play storyboard'}>{playing ? <Pause size={17} /> : <Play size={17} />}{motionAllowed ? playing ? 'Pause' : 'Play' : 'Motion off'}</button>
          <button type="button" onClick={() => nextScene(1)} aria-label="Next scene"><ChevronRight size={19} /></button>
          <span aria-live="polite">Scene {scene + 1} of {scenes.length}</span>
        </div>
        <div className="spice-ad__disclosure"><Check size={15} /><span>Creative preview only. No Meta account, ad budget or publishing action is connected here.</span></div>
      </div>
    </div> : <div id="spice-panel-google" role="tabpanel" aria-labelledby="spice-tab-google" className="spice-ad__stage spice-ad__stage--google">
      <div className="spice-ad__google-previews">
        <div className="spice-ad__search-card">
          <div className="spice-ad__search-query"><Search size={17} /><span>restaurants near Sholinganallur</span><span className="spice-ad__search-cursor" /></div>
          <div className="spice-ad__search-result"><div className="spice-ad__search-icon">S</div><div><span>SpiceRoute Kitchen · Sholinganallur</span><small>spiceroute.example · Menu</small></div></div>
          <span className="spice-ad__search-label">Sponsored text concept</span>
          <strong>SpiceRoute Kitchen | Explore the Menu</strong>
          <p>Warm plates, bold spice and an easy way to find us. Browse the menu and contact the kitchen directly.</p>
          <div className="spice-ad__search-links"><span>Menu</span><span>Location</span><span>Contact</span></div>
        </div>
        <div className="spice-ad__video-card">
          <div className="spice-ad__video-art" role="img" aria-label="Restaurant table with South Indian dishes"><span className="spice-ad__video-glow" /><span className="spice-ad__video-play"><Play fill="currentColor" size={18} /></span><span className="spice-ad__video-watermark">SpiceRoute<br />Kitchen</span></div>
          <div className="spice-ad__video-caption"><span>YouTube video-ad concept</span><strong>Good food is closer than you think.</strong><small>Illustrative motion frame · no video has been uploaded or served.</small></div>
        </div>
      </div>
      <div className="spice-ad__notes">
        <div className="spice-ad__notes-top"><span className="spice-ad__number">02 / 02</span><span>Search + video</span></div>
        <h3>Be there when someone is deciding where to eat.</h3>
        <p>The search ad demonstrates a local discovery message; the video frame suggests a short YouTube creative. Actual targeting, review, spend and impressions require a connected Google Ads account and campaign approval.</p>
        <div className="spice-ad__chips"><span><MapPin size={14} /> Local intent</span><span>Restaurant discovery</span><span>Website CTA</span></div>
        <div className="spice-ad__disclosure"><Check size={15} /><span>These are design mockups. No Google Ads or YouTube campaign has been created or published.</span></div>
      </div>
    </div>}

    <div className="spice-ad__footer">
      <span><strong>Next real step:</strong> approve the creative, connect ad accounts, set a spend cap, then submit for platform review.</span>
      <a href={destination} target="_blank" rel="noopener noreferrer">{isBundledDemo ? 'Open bundled demo site' : 'Open deployed site'} <ExternalLink size={15} /></a>
    </div>
  </section>;
}
