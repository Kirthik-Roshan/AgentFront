const FALLBACK_CONFIG = {
  "meta": {
    "template": "clinic-v1",
    "preview": true,
    "previewLabel": "Clinic template preview — verified content only"
  },
  "theme": {
    "ink": "#123532",
    "paper": "#eef7f3",
    "accent": "#168f7b",
    "sage": "#b7dfcf"
  },
  "business": {
    "name": "Asterwell Clinic",
    "descriptor": "Family care · Diagnostics · Wellness",
    "location": "Your neighbourhood",
    "phoneDisplay": "Add verified phone",
    "phoneLink": "",
    "whatsappLink": "",
    "bookingLink": "",
    "mapsLink": ""
  },
  "hero": {
    "eyebrow": "Care without the confusion",
    "title": "Feel heard. Get clear care.",
    "description": "A calm patient-first experience for trusted doctors and reassuring follow-up.",
    "cta": "Book an appointment"
  },
  "services": [
    {
      "number": "01",
      "name": "Family medicine",
      "description": "Everyday consultations and continuity of care."
    },
    {
      "number": "02",
      "name": "Women health",
      "description": "Private care through every life stage."
    },
    {
      "number": "03",
      "name": "Diagnostics",
      "description": "Coordinated tests with clear follow-up."
    },
    {
      "number": "04",
      "name": "Preventive care",
      "description": "Screening shaped around real life."
    }
  ],
  "pricing": {
    "note": "Publish only verified consultation details.",
    "items": [
      {
        "service": "Family medicine",
        "duration": "30 min",
        "price": "Ask clinic"
      },
      {
        "service": "Women health",
        "duration": "45 min",
        "price": "Ask clinic"
      },
      {
        "service": "Diagnostics",
        "duration": "30 min",
        "price": "Ask clinic"
      },
      {
        "service": "Preventive care",
        "duration": "20 min",
        "price": "Ask clinic"
      }
    ]
  },
  "gallery": [
    {
      "title": "Consultation rooms",
      "label": "Replace with approved clinic interior photography",
      "tone": "sand"
    },
    {
      "title": "Care team",
      "label": "Add consented physician and staff photography",
      "tone": "rose"
    },
    {
      "title": "Diagnostics & wellness",
      "label": "Show verified facilities and patient services",
      "tone": "sage"
    }
  ],
  "team": [
    {
      "name": "Lead physician",
      "role": "Add verified credentials",
      "initials": "MD"
    },
    {
      "name": "Care coordinator",
      "role": "Add verified role",
      "initials": "CC"
    },
    {
      "name": "Diagnostics lead",
      "role": "Add verified credentials",
      "initials": "DL"
    }
  ],
  "testimonials": [
    {
      "quote": "Add a genuine, permission-cleared client review here.",
      "author": "Verified client review"
    },
    {
      "quote": "Use this space for a concise outcome-focused testimonial.",
      "author": "Verified client review"
    }
  ],
  "hours": [
    {
      "days": "Monday – Saturday",
      "time": "Add verified hours"
    },
    {
      "days": "Sunday",
      "time": "Add verified hours"
    }
  ]
};
const safe=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
const at=(o,p)=>p.split(".").reduce((v,k)=>v?.[k],o);
const LINK_PROTOCOLS=new Set(["http:","https:","tel:","mailto:"]);
const WEB_PROTOCOLS=new Set(["http:","https:"]);const PHONE_PROTOCOLS=new Set(["tel:"]);
function validatedUrl(value,protocols=LINK_PROTOCOLS){if(typeof value!=="string"||!value.trim())return null;try{const url=new URL(value.trim(),window.location.href);return protocols.has(url.protocol.toLowerCase())?url.href:null}catch{return null}}
async function config(){if(location.protocol==="file:")return FALLBACK_CONFIG;try{const r=await fetch("business.config.json",{cache:"no-store"});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){console.info("Using embedded clinic preview configuration.",e.message);return FALLBACK_CONFIG}}
function link(id,href,protocols=LINK_PROTOCOLS){const n=document.getElementById(id);if(!n)return;const safeHref=validatedUrl(href,protocols);if(!safeHref){n.removeAttribute("href");n.removeAttribute("target");n.removeAttribute("rel");n.setAttribute("aria-disabled","true");return}n.href=safeHref;n.removeAttribute("aria-disabled");if(/^https?:$/.test(new URL(safeHref).protocol)){n.target="_blank";n.rel="noopener noreferrer"}else{n.removeAttribute("target");n.removeAttribute("rel")}}
function reveal(){const nodes=document.querySelectorAll(".reveal");if(!("IntersectionObserver"in window))return nodes.forEach(n=>n.classList.add("visible"));const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");observer.unobserve(e.target)}}),{threshold:.12});nodes.forEach(n=>observer.observe(n))}
function selectedVisit(item,c){
  const summary=document.getElementById("bookingSelection");
  summary.innerHTML=`<span>Your selected visit</span><strong>${safe(item.service)}</strong><small>${safe(item.duration)} · ${safe(item.price)}</small>`;
  const whatsapp=validatedUrl(c.business.whatsappLink,WEB_PROTOCOLS);
  if(whatsapp){
    const url=new URL(whatsapp);
    if(url.hostname==="wa.me"||url.hostname.endsWith(".whatsapp.com")){
      url.searchParams.set("text",`Hello ${c.business.name}, I would like to ask about ${item.service} (${item.duration}, ${item.price}).`);
      link("whatsappLink",url.href,WEB_PROTOCOLS);
    }
  }
  document.getElementById("booking").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});
}
function wireCarePathFinder(c){
  const tabs=document.getElementById("care-pathTabs");
  const shortcuts=document.getElementById("heroCarePathShortcuts");
  const image=document.querySelector(".hero-image");
  const services=Array.isArray(c.services)?c.services:[];
  if(!services.length){document.querySelector(".care-path-finder").hidden=true;document.querySelector(".hero-care-path-shortcuts").hidden=true;return}
  let active=0;
  const symbols=["✚","♡","◉","✓"];
  tabs.innerHTML=services.map((item,index)=>`<button type="button" data-care-path-index="${index}" aria-pressed="${index===0}"><span>${safe(item.number||String(index+1).padStart(2,"0"))}</span>${safe(item.name)}</button>`).join("");
  shortcuts.innerHTML=services.map((item,index)=>`<button type="button" data-care-path-index="${index}" aria-pressed="${index===0}">${safe(item.name)}</button>`).join("");
  const update=index=>{
    const item=services[index];if(!item)return;
    active=index;
    image.dataset.carePath=String(index%4);
    document.getElementById("care-pathSymbol").textContent=symbols[index%4];
    document.getElementById("care-pathStageNumber").textContent=String(index+1).padStart(2,"0");
    document.getElementById("care-pathStageName").textContent=item.name;
    document.getElementById("care-pathCount").textContent=`${String(index+1).padStart(2,"0")} / ${String(services.length).padStart(2,"0")}`;
    document.getElementById("care-pathNumber").textContent=`${safe(item.number||String(index+1).padStart(2,"0"))} / CARE PATH`;
    document.getElementById("care-pathName").textContent=item.name;
    document.getElementById("care-pathDescription").textContent=item.description;
    document.getElementById("care-pathPrice").textContent=c.pricing?.items?.[index]?.price||"Explore the service menu";
    [tabs,shortcuts].forEach(group=>group.querySelectorAll("button").forEach((button,i)=>button.setAttribute("aria-pressed",String(i===index))));
    const preview=document.querySelector(".care-path-preview");preview.classList.remove("care-path-updating");void preview.offsetWidth;preview.classList.add("care-path-updating");
  };
  tabs.addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-care-path-index]"):null;if(button)update(Number(button.dataset.carePathIndex))});
  shortcuts.addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-care-path-index]"):null;if(button)update(Number(button.dataset.carePathIndex))});
  document.getElementById("care-pathChoose").addEventListener("click",()=>{
    const item=c.pricing?.items?.[active];
    if(item)selectedVisit(item,c);else document.getElementById("pricing").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  });
  update(0);
}
function wireServices(c){
  document.getElementById("serviceGrid").addEventListener("click",event=>{
    const trigger=event.target instanceof Element?event.target.closest(".service-trigger"):null;if(!trigger)return;
    const open=trigger.getAttribute("aria-expanded")==="true";
    document.querySelectorAll(".service-trigger").forEach(button=>{button.setAttribute("aria-expanded","false");button.closest(".service-card").classList.remove("is-open");document.getElementById(button.getAttribute("aria-controls")).hidden=true});
    if(!open){trigger.setAttribute("aria-expanded","true");trigger.closest(".service-card").classList.add("is-open");document.getElementById(trigger.getAttribute("aria-controls")).hidden=false}
  });
  document.getElementById("priceList").addEventListener("click",event=>{
    const button=event.target instanceof Element?event.target.closest("[data-price-index]"):null;if(!button)return;
    const item=c.pricing.items[Number(button.dataset.priceIndex)];if(!item)return;
    document.querySelectorAll(".price-row").forEach(row=>row.classList.remove("is-selected"));
    button.closest(".price-row").classList.add("is-selected");
    selectedVisit(item,c);
  });
}
function wireNavigation(){
  const navigation=document.getElementById("nav");
  const sections=[...navigation.querySelectorAll('a[href^="#"]')].map(a=>({a,section:document.querySelector(a.getAttribute("href"))})).filter(x=>x.section);
  if("IntersectionObserver"in window){
    const observer=new IntersectionObserver(entries=>{
      const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if(!visible)return;
      sections.forEach(({a,section})=>{if(section===visible.target)a.setAttribute("aria-current","location");else a.removeAttribute("aria-current")});
    },{rootMargin:"-22% 0px -55% 0px",threshold:0});
    sections.forEach(({section})=>observer.observe(section));
  }
  let pending=false;
  const updateProgress=()=>{pending=false;const max=document.documentElement.scrollHeight-window.innerHeight;document.getElementById("scrollProgress").style.transform=`scaleX(${max>0?Math.min(1,window.scrollY/max):0})`};
  window.addEventListener("scroll",()=>{if(!pending){pending=true;requestAnimationFrame(updateProgress)}},{passive:true});
  window.addEventListener("resize",updateProgress);updateProgress();
  let navigationTimer;
  document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach(a=>a.addEventListener("click",event=>{
    const target=document.getElementById(a.hash.slice(1));
    if(!target||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    event.preventDefault();
    window.clearTimeout(navigationTimer);
    const label=target.querySelector("h2")?.textContent||target.querySelector("h1")?.textContent||"A moment for you";
    document.getElementById("routeVeilLabel").textContent=label;
    document.body.classList.remove("section-shifting");void document.body.offsetWidth;document.body.classList.add("section-shifting");
    window.history.pushState(null,"",a.hash);
    window.setTimeout(()=>target.scrollIntoView({behavior:"smooth",block:"start"}),190);
    navigationTimer=window.setTimeout(()=>document.body.classList.remove("section-shifting"),940);
  }));
}
function render(c){
  document.querySelectorAll("[data-field]").forEach(n=>{const v=at(c,n.dataset.field);if(v!==undefined)n.textContent=v});document.title=`${c.business.name} · Clinic`;
  Object.entries(c.theme||{}).forEach(([k,v])=>document.documentElement.style.setProperty(`--${k}`,v));
  const bar=document.getElementById("previewBar");bar.textContent=c.meta.previewLabel;bar.hidden=!c.meta.preview;
  document.getElementById("serviceGrid").innerHTML=c.services.map((x,i)=>`<article class="service-card reveal"><button class="service-trigger" type="button" aria-expanded="false" aria-controls="service-detail-${i}"><span class="service-number">${safe(x.number)}</span><span class="service-name">${safe(x.name)}</span><span class="service-arrow" aria-hidden="true">↗</span></button><div class="service-detail" id="service-detail-${i}" hidden><p>${safe(x.description)}</p><a href="#pricing">See the service menu <span aria-hidden="true">↗</span></a></div></article>`).join("");
  document.getElementById("priceList").innerHTML=c.pricing.items.map((x,i)=>`<div class="price-row"><div><h3>${safe(x.service)}</h3><span>${safe(x.duration)}</span></div><div class="price-action"><strong>${safe(x.price)}</strong><button type="button" data-price-index="${i}" aria-label="Choose ${safe(x.service)}">Choose <span aria-hidden="true">↗</span></button></div></div>`).join("");
  document.getElementById("galleryGrid").innerHTML=c.gallery.map((x,i)=>`<figure class="gallery-card gallery-${safe(x.tone)} reveal"><div><span>0${i+1}</span></div><figcaption><strong>${safe(x.title)}</strong><span>${safe(x.label)}</span></figcaption></figure>`).join("");
  document.getElementById("teamGrid").innerHTML=c.team.map(x=>`<article class="person reveal"><div class="portrait"><span>${safe(x.initials)}</span></div><h3>${safe(x.name)}</h3><p>${safe(x.role)}</p></article>`).join("");
  document.getElementById("quoteGrid").innerHTML=c.testimonials.map(x=>`<blockquote class="reveal"><p>“${safe(x.quote)}”</p><cite>${safe(x.author)}</cite></blockquote>`).join("");
  document.getElementById("hoursList").innerHTML=c.hours.map(x=>`<div><span>${safe(x.days)}</span><strong>${safe(x.time)}</strong></div>`).join("");
  link("bookingLink",c.business.bookingLink);link("whatsappLink",c.business.whatsappLink,WEB_PROTOCOLS);link("mapsLink",c.business.mapsLink,WEB_PROTOCOLS);link("phoneLink",c.business.phoneLink,PHONE_PROTOCOLS);
  document.getElementById("year").textContent=new Date().getFullYear();wireCarePathFinder(c);wireServices(c);wireNavigation();reveal();
}
const toggle=document.querySelector(".nav-toggle");toggle.addEventListener("click",()=>{const open=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",String(!open));document.getElementById("nav").classList.toggle("open",!open)});document.querySelectorAll("nav a").forEach(a=>a.addEventListener("click",()=>{toggle.setAttribute("aria-expanded","false");document.getElementById("nav").classList.remove("open")}));config().then(render);
