const FALLBACK_CONFIG={
  meta:{preview:true,previewLabel:"Garments template preview — replace with verified business content",commerceMode:"enquiry"},
  theme:{ink:"#171b29",paper:"#f2ecdf",accent:"#a74731",gold:"#b78a4b"},
  business:{name:"Loom & Line",descriptor:"Clothiers · Template preview",location:"Your neighbourhood",phoneDisplay:"Add verified phone",phoneLink:"",whatsappLink:"",mapsLink:""},
  hero:{eyebrow:"New season · Preview collection",title:"Clothes with a sense of place.",description:"A composed storefront for local garment businesses — built for discovery, collection enquiries and visits to the shop.",cta:"Explore collections",looks:[{name:"Indigo study",tone:"navy",note:"A cooler, quietly tailored mood."},{name:"Earth & ember",tone:"rust",note:"Warm colour, confident presence."},{name:"Golden hour",tone:"gold",note:"A softer glow for occasion dressing."}]},
  categories:[{index:"01",name:"Everyday wear",description:"Easy, repeat pieces."},{index:"02",name:"Celebration",description:"Occasion dressing."},{index:"03",name:"Menswear",description:"Tailored and relaxed looks."},{index:"04",name:"Textiles",description:"Fabric and finishing touches."}],
  collections:[{name:"Indigo study",caption:"Preview collection · replace with current stock",tone:"indigo",tag:"Collection 01"},{name:"Earth & ember",caption:"Preview collection · replace with current stock",tone:"ember",tag:"Collection 02"},{name:"Quiet occasion",caption:"Preview collection · replace with current stock",tone:"sand",tag:"Collection 03"}],
  offer:{enabled:true,eyebrow:"Store offer placeholder",title:"Give regular customers a reason to return.",description:"Configure this space only with a verified offer, validity period and applicable conditions.",terms:"No live offer is published in this template preview."},
  catalog:[{name:"Draped silhouettes",type:"Style story",category:"Everyday wear",tone:"navy",description:"A preview of fluid shapes and easy layering.",detail:"Shape and drape"},{name:"Hand-feel details",type:"Material story",category:"Textiles",tone:"rust",description:"A closer look at texture and the way fabric catches light.",detail:"Texture study"},{name:"Finishing touches",type:"Accessory story",category:"Menswear",tone:"cream",description:"Small details that make a look feel considered.",detail:"Details and accents"},{name:"Made for occasions",type:"Seasonal story",category:"Celebration",tone:"gold",description:"An occasionwear mood board to inspire your next visit.",detail:"Occasion styling"}],
  store:{title:"See the cloth. Feel the weave. Find your fit.",description:"Use this section for verified fitting services, alterations, size availability and store amenities.",hours:[{days:"Monday – Saturday",time:"Add verified hours"},{days:"Sunday",time:"Add verified hours"}]}
};
const safe=value=>String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[ch]);
const at=(object,path)=>path.split(".").reduce((value,key)=>value?.[key],object);
const WEB_PROTOCOLS=new Set(["http:","https:"]);
const PHONE_PROTOCOLS=new Set(["tel:"]);
const TONES=new Set(["navy","rust","cream","gold"]);
let config=FALLBACK_CONFIG,activeFilter="All",lastFocus=null,heroLooks=FALLBACK_CONFIG.hero.looks;

function setHeroLook(index,animate=false){
  const look=heroLooks[index];if(!look)return;
  const hero=document.querySelector(".hero"),panel=document.querySelector(".hero-look-lab");
  hero.dataset.look=look.tone;
  document.getElementById("heroLookTitle").textContent=look.name;
  document.getElementById("heroLookNote").textContent=look.note||"A new way to imagine the collection.";
  document.getElementById("heroLookIndex").textContent=`${String(index+1).padStart(2,"0")} / ${String(heroLooks.length).padStart(2,"0")}`;
  document.getElementById("heroImageTitle").textContent=look.name;
  document.getElementById("heroImagePosition").textContent=`${String(index+1).padStart(2,"0")} / ${String(heroLooks.length).padStart(2,"0")}`;
  panel.querySelectorAll("[data-look-index]").forEach(button=>button.setAttribute("aria-pressed",String(Number(button.dataset.lookIndex)===index)));
  if(animate){panel.classList.remove("look-updating");hero.classList.remove("look-changing");void panel.offsetWidth;panel.classList.add("look-updating");hero.classList.add("look-changing");setTimeout(()=>hero.classList.remove("look-changing"),800)}
}
function renderHeroLooks(){
  const proposed=Array.isArray(config.hero?.looks)?config.hero.looks:[];
  heroLooks=proposed.filter(look=>look&&typeof look.name==="string"&&TONES.has(look.tone)).slice(0,3);
  if(!heroLooks.length)heroLooks=FALLBACK_CONFIG.hero.looks;
  document.getElementById("heroLookChoices").innerHTML=heroLooks.map((look,index)=>`<button class="hero-look-button" type="button" data-look-index="${index}" data-look="${look.tone}" aria-pressed="false" aria-label="Preview ${safe(look.name)} colour story"><span class="hero-look-swatch" aria-hidden="true"></span><span>${safe(look.name)}</span></button>`).join("");
  setHeroLook(0);
}

function validatedUrl(value,protocols=WEB_PROTOCOLS){
  if(typeof value!=="string"||!value.trim())return null;
  try{const url=new URL(value.trim(),location.href);return protocols.has(url.protocol.toLowerCase())?url:null}catch{return null}
}
async function load(){
  if(location.protocol==="file:")return FALLBACK_CONFIG;
  try{const response=await fetch("business.config.json",{cache:"no-store"});if(!response.ok)throw new Error(String(response.status));return await response.json()}
  catch(error){console.info("Using embedded garments preview configuration.",error.message);return FALLBACK_CONFIG}
}
function setLink(id,href,protocols=WEB_PROTOCOLS){
  const node=document.getElementById(id),url=validatedUrl(href,protocols);if(!node)return;
  if(!url){node.removeAttribute("href");node.removeAttribute("target");node.removeAttribute("rel");node.setAttribute("aria-disabled","true");return}
  node.href=url.href;node.removeAttribute("aria-disabled");
  if(WEB_PROTOCOLS.has(url.protocol)){node.target="_blank";node.rel="noopener noreferrer"}
  else{node.removeAttribute("target");node.removeAttribute("rel")}
}
function observe(){
  const nodes=document.querySelectorAll(".reveal:not(.shown)");
  if(!("IntersectionObserver"in window)||matchMedia("(prefers-reduced-motion: reduce)").matches){nodes.forEach(node=>node.classList.add("shown"));return}
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("shown");observer.unobserve(entry.target)}}),{threshold:.08});
  nodes.forEach(node=>observer.observe(node));
}
const catalogCategory=item=>String(item.category||config.categories?.[config.catalog?.indexOf(item)]?.name||item.type||"Lookbook");
function renderCatalog(){
  const all=Array.isArray(config.catalog)?config.catalog:[];
  const categories=["All",...new Set(all.map(catalogCategory))];
  if(!categories.includes(activeFilter))activeFilter="All";
  document.getElementById("catalogFilters").innerHTML=categories.map(category=>`<button class="filter-chip" type="button" data-filter="${safe(category)}" aria-pressed="${category===activeFilter}">${safe(category==="All"?"All stories":category)}</button>`).join("");
  const visible=activeFilter==="All"?all:all.filter(item=>catalogCategory(item)===activeFilter);
  document.getElementById("catalogCount").textContent=`${visible.length} ${visible.length===1?"story":"stories"} ${activeFilter==="All"?"to explore":`in ${activeFilter}`}`;
  document.getElementById("catalogGrid").innerHTML=visible.map(item=>{
    const index=all.indexOf(item),tone=TONES.has(item.tone)?item.tone:"navy";
    return `<article class="catalog-card tone-${tone} reveal"><button class="catalog-open" type="button" data-item="${index}" aria-label="Explore ${safe(item.name)}"><span class="catalog-art"><span class="catalog-number">${String(index+1).padStart(2,"0")}</span><span class="fabric-form" aria-hidden="true"></span><span class="catalog-open-hint" aria-hidden="true">Explore story ↗</span></span><span class="catalog-meta">${safe(item.type)}</span><span class="catalog-title">${safe(item.name)}</span><span class="catalog-category">${safe(catalogCategory(item))}</span></button></article>`;
  }).join("");
  observe();
}
function selectFilter(category,moveToCatalog=false){
  activeFilter=category;renderCatalog();
  if(moveToCatalog){document.getElementById("catalog").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});document.querySelector(".filter-chip[aria-pressed='true']")?.focus({preventScroll:true})}
}
function enquiryUrl(item){
  const url=validatedUrl(config.business?.whatsappLink);if(!url)return null;
  if(/^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|www\.whatsapp\.com)$/.test(url.hostname)){
    const message=`Hello ${config.business.name}, I would like to ask about ${item.name} (${catalogCategory(item)}) from your lookbook.`;
    const existing=url.searchParams.get("text");url.searchParams.set("text",existing?`${existing}\n${message}`:message);
  }
  return url.href;
}
function openQuickView(index,trigger){
  const item=config.catalog?.[index];if(!item)return;lastFocus=trigger;
  document.getElementById("quickViewType").textContent=item.type||"Lookbook story";
  document.getElementById("quickViewTitle").textContent=item.name;
  document.getElementById("quickViewDescription").textContent=item.description||"Discover this story in store and ask about current availability.";
  document.getElementById("quickViewCategory").textContent=catalogCategory(item);
  document.getElementById("quickViewDetail").textContent=item.detail||"Ask about current styles";
  document.getElementById("quickViewArt").className=`quick-view-art tone-${TONES.has(item.tone)?item.tone:"navy"}`;
  const link=document.getElementById("quickViewEnquire"),url=enquiryUrl(item);
  if(url){link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.firstChild.textContent=`Ask about ${item.name} `;document.getElementById("quickViewNote").textContent="Availability and price are confirmed directly by the store."}
  else{link.href="#visit";link.removeAttribute("target");link.removeAttribute("rel");link.firstChild.textContent="See store contact details ";document.getElementById("quickViewNote").textContent="Add a verified WhatsApp link in business.config.json to enable item-specific enquiries."}
  const dialog=document.getElementById("quickView");if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
  document.getElementById("quickViewClose").focus();
}
function closeQuickView(){
  const dialog=document.getElementById("quickView");if(typeof dialog.close==="function")dialog.close();else dialog.removeAttribute("open");
  lastFocus?.focus();
}
function render(data){
  config=data;
  document.querySelectorAll("[data-field]").forEach(node=>{const value=at(config,node.dataset.field);if(value!==undefined)node.textContent=value});
  document.title=`${config.business.name} · Clothing`;
  Object.entries(config.theme||{}).forEach(([key,value])=>document.documentElement.style.setProperty(`--${key}`,value));
  const preview=document.getElementById("previewBar");preview.textContent=config.meta?.previewLabel||"Template preview";preview.hidden=!config.meta?.preview;
  document.getElementById("categoryList").innerHTML=(config.categories||[]).map(item=>`<article class="category reveal"><button type="button" data-category="${safe(item.name)}" aria-label="Explore ${safe(item.name)} in the lookbook"><span>${safe(item.index)}</span><strong>${safe(item.name)}</strong><span class="category-description">${safe(item.description)}</span><i aria-hidden="true">↗</i></button></article>`).join("");
  document.getElementById("collectionGrid").innerHTML=(config.collections||[]).map(item=>`<figure class="collection collection-${safe(item.tone)} reveal"><div><span>${safe(item.tag)}</span><i aria-hidden="true"></i></div><figcaption><h3>${safe(item.name)}</h3><p>${safe(item.caption)}</p><a class="collection-enquire" href="#catalog">Explore lookbook ↗</a></figcaption></figure>`).join("");
  document.getElementById("offerSection").hidden=!config.offer?.enabled;
  document.getElementById("hoursList").innerHTML=(config.store?.hours||[]).map(item=>`<div><span>${safe(item.days)}</span><strong>${safe(item.time)}</strong></div>`).join("");
  setLink("whatsappLink",config.business.whatsappLink);setLink("headerWhatsapp",config.business.whatsappLink);setLink("mapsLink",config.business.mapsLink);setLink("phoneLink",config.business.phoneLink,PHONE_PROTOCOLS);
  document.getElementById("year").textContent=new Date().getFullYear();
  renderHeroLooks();renderCatalog();observe();
}
const menuButton=document.querySelector(".nav-button"),nav=document.getElementById("nav");
menuButton.addEventListener("click",()=>{const open=menuButton.getAttribute("aria-expanded")==="true";menuButton.setAttribute("aria-expanded",String(!open));menuButton.querySelector(".sr-only").textContent=open?"Open menu":"Close menu";nav.classList.toggle("open",!open)});
nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{menuButton.setAttribute("aria-expanded","false");menuButton.querySelector(".sr-only").textContent="Open menu";nav.classList.remove("open")}));
document.getElementById("heroLookChoices").addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-look-index]"):null;if(button)setHeroLook(Number(button.dataset.lookIndex),true)});
document.getElementById("catalogFilters").addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-filter]"):null;if(button)selectFilter(button.dataset.filter)});
document.getElementById("categoryList").addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-category]"):null;if(button)selectFilter(button.dataset.category,true)});
document.getElementById("catalogGrid").addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest("[data-item]"):null;if(button)openQuickView(Number(button.dataset.item),button)});
document.getElementById("quickViewClose").addEventListener("click",closeQuickView);
document.getElementById("quickView").addEventListener("click",event=>{if(event.target===event.currentTarget)closeQuickView()});
document.getElementById("quickView").addEventListener("close",()=>lastFocus?.focus());
document.getElementById("quickViewEnquire").addEventListener("click",event=>{if(event.currentTarget.getAttribute("href")==="#visit")closeQuickView()});
if("IntersectionObserver"in window){
  const sectionObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;nav.querySelectorAll("a").forEach(link=>{if(link.hash===`#${entry.target.id}`)link.setAttribute("aria-current","location");else link.removeAttribute("aria-current")})}),{rootMargin:"-30% 0px -55% 0px"});
  nav.querySelectorAll("a").forEach(link=>{const section=document.querySelector(link.hash);if(section)sectionObserver.observe(section)});
}
let journeyTimer;
document.addEventListener("click",event=>{const link=event.target instanceof Element?event.target.closest('a[href^="#"]'):null;if(!link||link.getAttribute("aria-disabled")==="true")return;const target=document.querySelector(link.hash);if(!target)return;document.body.classList.remove("is-navigating");void document.body.offsetWidth;document.body.classList.add("is-navigating");clearTimeout(journeyTimer);journeyTimer=setTimeout(()=>document.body.classList.remove("is-navigating"),900);target.classList.remove("section-arrived");requestAnimationFrame(()=>target.classList.add("section-arrived"));setTimeout(()=>target.classList.remove("section-arrived"),1100)});
load().then(render);
