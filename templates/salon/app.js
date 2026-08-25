const FALLBACK_CONFIG = {
  meta:{preview:true,previewLabel:"Salon template preview — replace with verified business content"},theme:{ink:"#25211f",paper:"#f4f0ea",accent:"#a86f62",sage:"#b8bfaa"},
  business:{name:"Studio Muse",descriptor:"Hair · Beauty · Ritual",location:"Your neighbourhood",phoneDisplay:"Add verified phone",phoneLink:"",whatsappLink:"",bookingLink:"",mapsLink:""},
  hero:{eyebrow:"A quieter kind of beauty",title:"Care that feels entirely your own.",description:"An elegant, mobile-first salon template built for clear services, confident pricing and effortless bookings.",cta:"Book your visit"},
  services:[{number:"01",name:"Cut & finish",description:"Consultation-led cuts, styling and event-ready finishes."},{number:"02",name:"Colour studio",description:"Dimensional colour, gloss, root care and tone refreshes."},{number:"03",name:"Skin rituals",description:"Personalised facials and restorative skin treatments."},{number:"04",name:"Hands & feet",description:"Thoughtful nail care, polish and finishing rituals."}],
  pricing:{note:"Preview pricing — replace with the salon's approved service list.",items:[{service:"Signature haircut",duration:"60 min",price:"from ₹900"},{service:"Colour consultation",duration:"30 min",price:"complimentary"},{service:"Restorative facial",duration:"75 min",price:"from ₹1,800"},{service:"Classic manicure",duration:"45 min",price:"from ₹750"}]},
  gallery:[{title:"The studio",label:"Replace with approved interior photography",tone:"sand"},{title:"Hair craft",label:"Add real client-approved work",tone:"rose"},{title:"Quiet details",label:"Show products or treatment spaces",tone:"sage"}],
  team:[{name:"Lead stylist",role:"Add verified name and speciality",initials:"LS"},{name:"Beauty therapist",role:"Add verified name and speciality",initials:"BT"},{name:"Nail artist",role:"Add verified name and speciality",initials:"NA"}],
  testimonials:[{quote:"Add a genuine, permission-cleared client review here.",author:"Verified client review"},{quote:"Use this space for a concise outcome-focused testimonial.",author:"Verified client review"}],
  hours:[{days:"Monday – Saturday",time:"Add verified hours"},{days:"Sunday",time:"Add verified hours"}]
};
const safe=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
const at=(o,p)=>p.split(".").reduce((v,k)=>v?.[k],o);
const LINK_PROTOCOLS=new Set(["http:","https:","tel:","mailto:"]);
const WEB_PROTOCOLS=new Set(["http:","https:"]);const PHONE_PROTOCOLS=new Set(["tel:"]);
function validatedUrl(value,protocols=LINK_PROTOCOLS){if(typeof value!=="string"||!value.trim())return null;try{const url=new URL(value.trim(),window.location.href);return protocols.has(url.protocol.toLowerCase())?url.href:null}catch{return null}}
async function config(){if(location.protocol==="file:")return FALLBACK_CONFIG;try{const r=await fetch("business.config.json",{cache:"no-store"});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){console.info("Using embedded salon preview configuration.",e.message);return FALLBACK_CONFIG}}
function link(id,href,protocols=LINK_PROTOCOLS){const n=document.getElementById(id);if(!n)return;const safeHref=validatedUrl(href,protocols);if(!safeHref){n.removeAttribute("href");n.removeAttribute("target");n.removeAttribute("rel");n.setAttribute("aria-disabled","true");return}n.href=safeHref;n.removeAttribute("aria-disabled");if(/^https?:$/.test(new URL(safeHref).protocol)){n.target="_blank";n.rel="noopener noreferrer"}else{n.removeAttribute("target");n.removeAttribute("rel")}}
function reveal(){const nodes=document.querySelectorAll(".reveal");if(!("IntersectionObserver"in window))return nodes.forEach(n=>n.classList.add("visible"));const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");observer.unobserve(e.target)}}),{threshold:.12});nodes.forEach(n=>observer.observe(n))}
function render(c){
  document.querySelectorAll("[data-field]").forEach(n=>{const v=at(c,n.dataset.field);if(v!==undefined)n.textContent=v});document.title=`${c.business.name} · Salon`;
  Object.entries(c.theme||{}).forEach(([k,v])=>document.documentElement.style.setProperty(`--${k}`,v));
  const bar=document.getElementById("previewBar");bar.textContent=c.meta.previewLabel;bar.hidden=!c.meta.preview;
  document.getElementById("serviceGrid").innerHTML=c.services.map(x=>`<article class="service-card reveal"><span>${safe(x.number)}</span><div><h3>${safe(x.name)}</h3><p>${safe(x.description)}</p></div><i aria-hidden="true">↗</i></article>`).join("");
  document.getElementById("priceList").innerHTML=c.pricing.items.map(x=>`<div class="price-row"><div><h3>${safe(x.service)}</h3><span>${safe(x.duration)}</span></div><strong>${safe(x.price)}</strong></div>`).join("");
  document.getElementById("galleryGrid").innerHTML=c.gallery.map((x,i)=>`<figure class="gallery-card gallery-${safe(x.tone)} reveal"><div><span>0${i+1}</span></div><figcaption><strong>${safe(x.title)}</strong><span>${safe(x.label)}</span></figcaption></figure>`).join("");
  document.getElementById("teamGrid").innerHTML=c.team.map(x=>`<article class="person reveal"><div class="portrait"><span>${safe(x.initials)}</span></div><h3>${safe(x.name)}</h3><p>${safe(x.role)}</p></article>`).join("");
  document.getElementById("quoteGrid").innerHTML=c.testimonials.map(x=>`<blockquote class="reveal"><p>“${safe(x.quote)}”</p><cite>${safe(x.author)}</cite></blockquote>`).join("");
  document.getElementById("hoursList").innerHTML=c.hours.map(x=>`<div><span>${safe(x.days)}</span><strong>${safe(x.time)}</strong></div>`).join("");
  link("bookingLink",c.business.bookingLink);link("whatsappLink",c.business.whatsappLink,WEB_PROTOCOLS);link("mapsLink",c.business.mapsLink,WEB_PROTOCOLS);link("phoneLink",c.business.phoneLink,PHONE_PROTOCOLS);
  document.getElementById("year").textContent=new Date().getFullYear();reveal();
}
const toggle=document.querySelector(".nav-toggle");toggle.addEventListener("click",()=>{const open=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",String(!open));document.getElementById("nav").classList.toggle("open",!open)});document.querySelectorAll("nav a").forEach(a=>a.addEventListener("click",()=>{toggle.setAttribute("aria-expanded","false");document.getElementById("nav").classList.remove("open")}));config().then(render);
