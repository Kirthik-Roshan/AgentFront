const FALLBACK_CONFIG={
 meta:{preview:true,previewLabel:"Mechanic workshop template preview — replace with verified business content"},theme:{ink:"#101816",panel:"#192420",paper:"#eff0e8",accent:"#f4ad32",signal:"#d85535"},
 business:{name:"Northline Auto Care",descriptor:"Independent workshop · Template preview",location:"Your neighbourhood",phoneDisplay:"Add verified phone",phoneLink:"",whatsappLink:"",emergencyLink:"",mapsLink:""},hero:{eyebrow:"Straight answers. Skilled hands.",title:"Keep moving with service you can trust.",description:"A fast, clear workshop website system built around service discovery, urgent contact and direct WhatsApp enquiries.",primaryCta:"Request a service",secondaryCta:"View workshop services"},
 triage:{eyebrow:"Quick service guide",title:"Tell us what your vehicle is doing.",description:"Choose a vehicle and a concern. We'll suggest a starting service, not claim a diagnosis.",disclaimer:"A technician must inspect the vehicle before confirming any repair or price.",issues:[{label:"Warning light",detail:"A dashboard alert or unusual reading",serviceCode:"SRV-02",guidance:"Start with a diagnostic review so the workshop can identify the fault before recommending repairs."},{label:"Braking or steering",detail:"Noise, vibration or a change in control",serviceCode:"SRV-03",guidance:"A brake and suspension inspection is the safest starting point."},{label:"Routine service",detail:"Oil, filters or a general check",serviceCode:"SRV-01",guidance:"A general service can review the essentials and document what needs attention."},{label:"Cooling or electrical",detail:"AC, battery or starting concerns",serviceCode:"SRV-04",guidance:"An AC and electrical check can narrow down the issue before any work is approved."}]},
 trust:[{value:"01",label:"Clear diagnosis"},{value:"02",label:"Approved repairs"},{value:"03",label:"Service updates"}],
 services:[{code:"SRV-01",name:"General service",description:"Inspection, oil and filter care, fluid checks and a clear service summary."},{code:"SRV-02",name:"Engine diagnostics",description:"Fault tracing and diagnostic review before any repair is approved."},{code:"SRV-03",name:"Brakes & suspension",description:"Inspection and repair for braking, steering and ride concerns."},{code:"SRV-04",name:"AC & electrical",description:"Cooling, battery, starting and electrical-system diagnosis."}],vehicles:["Hatchbacks","Sedans","SUVs","Two-wheelers"],
 packages:{note:"Preview package details — replace with approved scope and pricing.",items:[{name:"Essential check",tag:"Routine care",price:"Quote after inspection",includes:["Multi-point inspection","Fluid and tyre check","Service recommendation"]},{name:"Road-ready service",tag:"Popular",price:"Quote after inspection",includes:["Essential check scope","Oil and filter review","Diagnostic scan"]},{name:"Pre-trip inspection",tag:"Long drives",price:"Quote after inspection",includes:["Safety systems review","Battery and AC check","Written findings"]}]},
 gallery:[{title:"Diagnostic bay",caption:"Replace with approved workshop photography",tone:"graphite"},{title:"Service in progress",caption:"Show real technicians with permission",tone:"amber"},{title:"Tools & standards",caption:"Document genuine equipment and process",tone:"steel"}],testimonials:[{quote:"Add a genuine, permission-cleared customer review here.",author:"Verified customer review"},{quote:"Use this space for a concise review about service and communication.",author:"Verified customer review"}],hours:[{days:"Monday – Saturday",time:"Add verified hours"},{days:"Sunday",time:"Add verified hours"}]
	};
	const safe=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);const at=(o,p)=>p.split(".").reduce((v,k)=>v?.[k],o);
	const LINK_PROTOCOLS=new Set(["http:","https:","tel:","mailto:"]);const WEB_PROTOCOLS=new Set(["http:","https:"]);const PHONE_PROTOCOLS=new Set(["tel:"]);function validatedUrl(value,protocols=LINK_PROTOCOLS){if(typeof value!=="string"||!value.trim())return null;try{const url=new URL(value.trim(),window.location.href);return protocols.has(url.protocol.toLowerCase())?url.href:null}catch{return null}}
	async function load(){if(location.protocol==="file:")return FALLBACK_CONFIG;try{const r=await fetch("business.config.json",{cache:"no-store"});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){console.info("Using embedded mechanic preview configuration.",e.message);return FALLBACK_CONFIG}}
	function link(id,href,protocols=LINK_PROTOCOLS){const n=document.getElementById(id);if(!n)return;const safeHref=validatedUrl(href,protocols);if(!safeHref){n.removeAttribute("href");n.removeAttribute("target");n.removeAttribute("rel");n.setAttribute("aria-disabled","true");return}n.href=safeHref;n.removeAttribute("aria-disabled");if(/^https?:$/.test(new URL(safeHref).protocol)){n.target="_blank";n.rel="noopener noreferrer"}else{n.removeAttribute("target");n.removeAttribute("rel")}}
function observe(){const nodes=document.querySelectorAll(".reveal");if(!("IntersectionObserver"in window))return nodes.forEach(n=>n.classList.add("shown"));const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("shown");o.unobserve(e.target)}}),{threshold:.1});nodes.forEach(n=>o.observe(n))}
function render(c){
 document.querySelectorAll("[data-field]").forEach(n=>{const v=at(c,n.dataset.field);if(v!==undefined)n.textContent=v});document.title=`${c.business.name} · Auto care`;Object.entries(c.theme||{}).forEach(([k,v])=>document.documentElement.style.setProperty(`--${k}`,v));const b=document.getElementById("previewBar");b.textContent=c.meta.previewLabel;b.hidden=!c.meta.preview;
 document.getElementById("trustGrid").innerHTML=c.trust.map(x=>`<div class="trust-item reveal"><strong>${safe(x.value)}</strong><span>${safe(x.label)}</span></div>`).join("");
 document.getElementById("serviceGrid").innerHTML=c.services.map(x=>`<article class="service-card reveal"><span>${safe(x.code)}</span><div><h3>${safe(x.name)}</h3><p>${safe(x.description)}</p><a href="#diagnostic" class="service-card__action">Explore this service ↗</a></div><i aria-hidden="true">↗</i></article>`).join("");
 document.getElementById("vehicleList").innerHTML=c.vehicles.map((x,i)=>`<div class="vehicle reveal"><span>${String(i+1).padStart(2,"0")}</span><strong>${safe(x)}</strong></div>`).join("");
 document.getElementById("packageGrid").innerHTML=c.packages.items.map(x=>`<article class="package-card reveal"><p class="eyebrow">${safe(x.tag)}</p><h3>${safe(x.name)}</h3><strong>${safe(x.price)}</strong><ul>${x.includes.map(y=>`<li>${safe(y)}</li>`).join("")}</ul><a href="#contact">Request this service ↗</a></article>`).join("");
 document.getElementById("galleryGrid").innerHTML=c.gallery.map((x,i)=>`<figure class="gallery-card tone-${safe(x.tone)} reveal"><div><span>${String(i+1).padStart(2,"0")}</span></div><figcaption><strong>${safe(x.title)}</strong><span>${safe(x.caption)}</span></figcaption></figure>`).join("");
 document.getElementById("reviewGrid").innerHTML=c.testimonials.map(x=>`<blockquote class="reveal"><p>“${safe(x.quote)}”</p><cite>${safe(x.author)}</cite></blockquote>`).join("");
 document.getElementById("hoursList").innerHTML=c.hours.map(x=>`<div><span>${safe(x.days)}</span><strong>${safe(x.time)}</strong></div>`).join("");
	 link("headerPhone",c.business.phoneLink,PHONE_PROTOCOLS);link("phoneLink",c.business.phoneLink,PHONE_PROTOCOLS);link("whatsappLink",c.business.whatsappLink,WEB_PROTOCOLS);link("emergencyLink",c.business.emergencyLink||c.business.phoneLink);link("mapsLink",c.business.mapsLink,WEB_PROTOCOLS);document.getElementById("year").textContent=new Date().getFullYear();const triage=setupTriage(c);setupHeroConsole(c,triage);setupSectionNavigation();observe();
}
function setupHeroConsole(config,triage){
 const issues=(config.triage?.issues?.length?config.triage:FALLBACK_CONFIG.triage).issues.slice(0,3);
 const panel=document.querySelector(".hero-console");
 const choices=document.getElementById("heroSignalChoices");
 const title=document.getElementById("heroSignalTitle");
 const description=document.getElementById("heroSignalDescription");
 let selectedIndex=0;
 choices.innerHTML=issues.map((issue,index)=>`<button type="button" data-signal="${index}" aria-pressed="false"><span>${String(index+1).padStart(2,"0")}</span>${safe(issue.label)}</button>`).join("");
 function select(index,animate=false){
  const issue=issues[index];if(!issue)return;
  selectedIndex=index;
  title.textContent=issue.label;
  description.textContent=issue.guidance;
  panel.style.setProperty("--signal-angle",`${index*115}deg`);
  if(animate){panel.classList.remove("is-changing");void panel.offsetWidth;panel.classList.add("is-changing")}
  choices.querySelectorAll("button").forEach((button,buttonIndex)=>button.setAttribute("aria-pressed",String(buttonIndex===index)));
 }
 choices.addEventListener("click",event=>{if(!(event.target instanceof Element))return;const button=event.target.closest("button[data-signal]");if(button)select(Number(button.dataset.signal),true)});
 panel.querySelector(".hero-console__action").addEventListener("click",()=>{triage.selectIssue(selectedIndex);requestAnimationFrame(()=>document.getElementById("triageVehicle").focus({preventScroll:true}))});
 select(0);
}
function setupTriage(config){
 const triage=config.triage?.issues?.length?config.triage:FALLBACK_CONFIG.triage;
 const vehicleSelect=document.getElementById("triageVehicle");
 const choices=document.getElementById("triageChoices");
 const result=document.getElementById("triageResult");
 const title=document.getElementById("triageResultTitle");
 const description=document.getElementById("triageResultDescription");
 const copyButton=document.getElementById("copyServiceBrief");
 const contact=document.getElementById("triageContact");
 vehicleSelect.innerHTML='<option value="">Choose a vehicle</option>'+config.vehicles.map(vehicle=>`<option value="${safe(vehicle)}">${safe(vehicle)}</option>`).join("");
 choices.innerHTML=triage.issues.map((issue,index)=>`<button type="button" class="diagnostic-choice" data-issue="${index}" aria-pressed="false"><span>${safe(issue.label)}</span><small>${safe(issue.detail)}</small><i aria-hidden="true">↗</i></button>`).join("");
 let selectedIssue=-1;
 let brief="";
 function update(){
  const vehicle=vehicleSelect.value;
  const issue=triage.issues[selectedIssue];
  choices.querySelectorAll("button").forEach(button=>button.setAttribute("aria-pressed",String(Number(button.dataset.issue)===selectedIssue)));
  result.classList.toggle("is-ready",Boolean(vehicle&&issue));
  result.classList.remove("is-updating");if(vehicle&&issue){void result.offsetWidth;result.classList.add("is-updating")}
 copyButton.disabled=!(vehicle&&issue);
 copyButton.textContent="Copy service brief";
  contact.removeAttribute("target");contact.removeAttribute("rel");
  if(!vehicle){title.textContent=issue?"Add your vehicle to continue.":"Your service brief starts here.";description.textContent=issue?`You selected ${issue.label.toLowerCase()}. Choose your vehicle to see a relevant starting service.`:"Choose a vehicle and a concern to build a useful service brief.";contact.href="#contact";contact.textContent="Contact options ↗";return}
  if(!issue){title.textContent="What are you noticing?";description.textContent=`Choose a concern for your ${vehicle.toLowerCase()} to see a suggested starting service.`;contact.href="#contact";contact.textContent="Contact options ↗";return}
  const service=config.services.find(item=>item.code===issue.serviceCode);
  title.textContent=service?.name||"Workshop inspection";
  description.textContent=issue.guidance;
  brief=`Hello, I have a ${vehicle}. I noticed: ${issue.label}. I'd like to ask about ${service?.name||"an inspection"}.`;
  const whatsapp=validatedUrl(config.business.whatsappLink,WEB_PROTOCOLS);
  if(whatsapp){
   const url=new URL(whatsapp);
   if(url.hostname==="wa.me"||url.hostname==="api.whatsapp.com"||url.hostname==="web.whatsapp.com"){
    url.searchParams.set("text",brief);contact.href=url.href;contact.target="_blank";contact.rel="noopener noreferrer";contact.textContent="Enquire on WhatsApp ↗";return;
   }
  }
  contact.href="#contact";contact.removeAttribute("target");contact.removeAttribute("rel");contact.textContent="Contact options ↗";
 }
 vehicleSelect.addEventListener("change",update);
 choices.addEventListener("click",event=>{if(!(event.target instanceof Element))return;const button=event.target.closest("button[data-issue]");if(!button||button.disabled)return;selectedIssue=Number(button.dataset.issue);update()});
 copyButton.addEventListener("click",async()=>{if(!brief)return;try{await navigator.clipboard.writeText(brief);copyButton.textContent="Brief copied ✓"}catch{copyButton.textContent="Copy unavailable"}});
 update();
 return {selectIssue(index){if(!triage.issues[index])return;selectedIssue=index;update()}};
}
function setupSectionNavigation(){
 const links=[...document.querySelectorAll('nav a[href^="#"]')];
 if("IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;links.forEach(link=>{const active=link.hash===`#${entry.target.id}`;link.classList.toggle("is-current",active);if(active)link.setAttribute("aria-current","location");else link.removeAttribute("aria-current")})}),{rootMargin:"-20% 0px -65% 0px"});
  links.forEach(link=>{const target=document.querySelector(link.hash);if(target)observer.observe(target)});
 }
 document.addEventListener("click",event=>{
  if(!(event.target instanceof Element))return;
  const link=event.target.closest('a[href^="#"]');
  if(!link||!link.hash||!document.getElementById(link.hash.slice(1)))return;
  document.body.classList.remove("is-routing");
  void document.body.offsetWidth;
  document.body.classList.add("is-routing");
  window.setTimeout(()=>document.body.classList.remove("is-routing"),760);
 });
}
const t=document.querySelector(".nav-toggle");t.addEventListener("click",()=>{const open=t.getAttribute("aria-expanded")==="true";t.setAttribute("aria-expanded",String(!open));document.getElementById("nav").classList.toggle("open",!open)});document.querySelectorAll("nav a").forEach(a=>a.addEventListener("click",()=>{t.setAttribute("aria-expanded","false");document.getElementById("nav").classList.remove("open")}));load().then(render);
