const FALLBACK_CONFIG = {
  meta: { preview: true, previewLabel: "Restaurant template preview — replace with verified business content" },
  theme: { ink: "#17201b", paper: "#f7f1e6", accent: "#d86532", accentSoft: "#efc46d" },
  business: { name: "Ember & Leaf", eyebrow: "Season-led kitchen · Template preview", location: "Your neighbourhood", phoneDisplay: "Add verified phone", phoneLink: "", whatsappLink: "", reservationLink: "", mapsLink: "" },
  hero: { kicker: "A neighbourhood table", title: "Familiar flavours, served with a little fire.", description: "A configurable restaurant experience designed to turn hungry visitors into confident diners and direct orders.", primaryCta: "Explore the menu", secondaryCta: "Find the restaurant" },
  about: { eyebrow: "Our approach", title: "Good ingredients. Warm service. No unnecessary fuss.", body: "Use this space for the restaurant's verified story, cooking philosophy and the details guests remember.", facts: [{ value: "01", label: "Verified story" }, { value: "02", label: "Seasonal highlights" }, { value: "03", label: "Direct ordering" }] },
  menu: { note: "Preview dishes and prices — replace during client onboarding.", categories: [{ name: "Small plates", items: [{ name: "Charred corn chaat", description: "Tamarind, chilli and toasted peanuts", price: "₹260" }, { name: "Pepper paneer", description: "Curry leaf, shallot and cracked pepper", price: "₹340" }] }, { name: "From the kitchen", items: [{ name: "Smoked tomato curry", description: "Cashew, fenugreek and seasonal vegetables", price: "₹420" }, { name: "Clay-pot chicken", description: "Roasted spice, coconut and red chilli", price: "₹520" }] }] },
  offers: [{ label: "Weekday table", title: "Lunch, made unhurried", description: "Configure this card with a verified weekday offer or remove the section entirely." }, { label: "For groups", title: "Menus worth sharing", description: "Highlight group dining, catering or celebration packages here." }],
  reservations: { eyebrow: "Reservations", title: "A table, set aside for you.", description: "Choose a date and party size through the restaurant's configured reservation channel.", cta: "Request a table" },
  gallery: [{ title: "Signature plates", caption: "Replace with approved food photography", tone: "saffron" }, { title: "The dining room", caption: "Show the real space and atmosphere", tone: "forest" }, { title: "At the pass", caption: "Share a genuine kitchen moment", tone: "clay" }],
  hours: [{ days: "Monday – Friday", time: "Add verified hours" }, { days: "Saturday – Sunday", time: "Add verified hours" }],
  features: { offers: true, reservations: false, whatsappOrdering: true }
};

const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const LINK_PROTOCOLS = new Set(["http:", "https:", "tel:", "mailto:"]);
const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const PHONE_PROTOCOLS = new Set(["tel:"]);

function validatedUrl(value, protocols = LINK_PROTOCOLS) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), window.location.href);
    return protocols.has(url.protocol.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

function configureLink(node, href, protocols = LINK_PROTOCOLS) {
  const safeHref = validatedUrl(href, protocols);
  if (!safeHref) {
    node.removeAttribute("href");
    node.removeAttribute("target");
    node.removeAttribute("rel");
    node.setAttribute("aria-disabled", "true");
    return false;
  }
  node.href = safeHref;
  node.removeAttribute("aria-disabled");
  if (/^https?:$/.test(new URL(safeHref).protocol)) {
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  } else {
    node.removeAttribute("target");
    node.removeAttribute("rel");
  }
  return true;
}

function createTextElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  return node;
}

async function loadConfig() {
  if (location.protocol === "file:") return FALLBACK_CONFIG;
  try {
    const response = await fetch("business.config.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Configuration request failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.info("Using the embedded restaurant preview configuration.", error.message);
    return FALLBACK_CONFIG;
  }
}

function bindFields(config) {
  document.querySelectorAll("[data-field]").forEach(node => {
    const value = get(config, node.dataset.field);
    if (value !== undefined && value !== null) node.textContent = value;
  });
  document.title = `${config.business.name} · Restaurant`;
  Object.entries(config.theme || {}).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`, value));
}

function render(config) {
  bindFields(config);
  document.getElementById("previewBar").textContent = config.meta.previewLabel;
  document.getElementById("previewBar").hidden = !config.meta.preview;
  document.getElementById("factGrid").innerHTML = config.about.facts.map(fact => `<div><strong>${escapeHtml(fact.value)}</strong><span>${escapeHtml(fact.label)}</span></div>`).join("");
  document.getElementById("menuGrid").innerHTML = config.menu.categories.map(category => `<article class="menu-card reveal"><p class="eyebrow">${escapeHtml(category.name)}</p>${category.items.map(item => `<div class="menu-item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p></div><strong>${escapeHtml(item.price)}</strong></div>`).join("")}</article>`).join("");
  document.getElementById("offerGrid").innerHTML = config.offers.map((offer, index) => `<article class="offer-card reveal"><span>0${index + 1}</span><div><p class="eyebrow">${escapeHtml(offer.label)}</p><h3>${escapeHtml(offer.title)}</h3><p>${escapeHtml(offer.description)}</p></div></article>`).join("");
  document.getElementById("offersSection").hidden = !config.features.offers;
  document.getElementById("galleryGrid").innerHTML = config.gallery.map((item, index) => `<figure class="gallery-card tone-${escapeHtml(item.tone)} reveal"><div class="gallery-art"><span>${String(index + 1).padStart(2, "0")}</span></div><figcaption><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.caption)}</span></figcaption></figure>`).join("");
  document.getElementById("hoursList").innerHTML = config.hours.map(row => `<div class="hours-row"><span>${escapeHtml(row.days)}</span><strong>${escapeHtml(row.time)}</strong></div>`).join("");
  const links = [["whatsappLink", config.business.whatsappLink, WEB_PROTOCOLS], ["mapsLink", config.business.mapsLink, WEB_PROTOCOLS], ["phoneLink", config.business.phoneLink, PHONE_PROTOCOLS]];
  links.forEach(([id, href, protocols]) => {
    const node = document.getElementById(id);
    if (node) configureLink(node, href, protocols);
  });
  if (!config.features.whatsappOrdering) document.getElementById("whatsappLink").hidden = true;
  renderReservations(config);
  document.getElementById("year").textContent = new Date().getFullYear();
  observeReveals();
}

function renderReservations(config) {
  const mount = document.getElementById("reservationMount");
  const navigation = document.getElementById("siteNav");
  mount.replaceChildren();
  navigation.querySelector("[data-reservations-nav]")?.remove();
  if (!config.features?.reservations) return;

  const copy = config.reservations || FALLBACK_CONFIG.reservations;
  const section = document.createElement("section");
  section.className = "reservations section-shell";
  section.id = "reservations";
  const panel = document.createElement("div");
  panel.className = "reservation-panel reveal";
  const content = document.createElement("div");
  content.append(
    createTextElement("p", "eyebrow", copy.eyebrow),
    createTextElement("h2", "", copy.title),
    createTextElement("p", "reservation-copy", copy.description),
  );
  const action = createTextElement("a", "button button-light", copy.cta);
  const reservationHref = config.business.reservationLink || config.business.whatsappLink || config.business.phoneLink;
  configureLink(action, reservationHref);
  panel.append(content, action);
  section.append(panel);
  mount.append(section);

  const navLink = createTextElement("a", "", "Reservations");
  navLink.href = "#reservations";
  navLink.dataset.reservationsNav = "true";
  navLink.addEventListener("click", () => {
    const toggle = document.querySelector(".menu-toggle");
    toggle.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  });
  navigation.insertBefore(navLink, navigation.querySelector('a[href="#visit"]'));
}

function observeReveals() {
  if (!("IntersectionObserver" in window)) return document.querySelectorAll(".reveal").forEach(node => node.classList.add("is-visible"));
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(node => observer.observe(node));
}

const toggle = document.querySelector(".menu-toggle");
toggle.addEventListener("click", () => { const open = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!open)); document.getElementById("siteNav").classList.toggle("is-open", !open); });
document.querySelectorAll(".site-nav a").forEach(link => link.addEventListener("click", () => { toggle.setAttribute("aria-expanded", "false"); document.getElementById("siteNav").classList.remove("is-open"); }));
loadConfig().then(render);
