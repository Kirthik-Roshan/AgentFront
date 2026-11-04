const FALLBACK_CONFIG = {
  meta: { preview: true, previewLabel: "Bakery template preview — replace with verified business content" },
  theme: { ink: "#17201b", paper: "#f7f1e6", accent: "#d86532", accentSoft: "#efc46d" },
  business: { name: "Butter & Bloom", eyebrow: "Season-led kitchen · Template preview", location: "Your neighbourhood", phoneDisplay: "Add verified phone", phoneLink: "", whatsappLink: "", reservationLink: "", mapsLink: "" },
  hero: { kicker: "A neighbourhood table", title: "Familiar flavours, served with a little fire.", description: "A configurable bakery experience designed to turn hungry visitors into confident diners and direct orders.", primaryCta: "Explore the menu", secondaryCta: "Find the bakery" },
  about: { eyebrow: "Our approach", title: "Good ingredients. Warm service. No unnecessary fuss.", body: "Use this space for the bakery's verified story, cooking philosophy and the details guests remember.", facts: [{ value: "01", label: "Verified story" }, { value: "02", label: "Seasonal highlights" }, { value: "03", label: "Direct ordering" }] },
  menu: { note: "Preview dishes and prices — replace during client onboarding.", categories: [{ name: "Small plates", items: [{ name: "Charred corn chaat", description: "Tamarind, chilli and toasted peanuts", price: "₹260" }, { name: "Pepper paneer", description: "Curry leaf, shallot and cracked pepper", price: "₹340" }] }, { name: "From the kitchen", items: [{ name: "Smoked tomato curry", description: "Cashew, fenugreek and seasonal vegetables", price: "₹420" }, { name: "Clay-pot chicken", description: "Roasted spice, coconut and red chilli", price: "₹520" }] }] },
  offers: [{ label: "Weekday table", title: "Lunch, made unhurried", description: "Configure this card with a verified weekday offer or remove the section entirely." }, { label: "For groups", title: "Bake lists worth sharing", description: "Highlight group dining, catering or celebration packages here." }],
  reservations: { eyebrow: "Pre-orders", title: "A table, set aside for you.", description: "Choose a date and party size through the bakery's configured pre-order channel.", cta: "Request a table" },
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
    console.info("Using the embedded bakery preview configuration.", error.message);
    return FALLBACK_CONFIG;
  }
}

function bindFields(config) {
  document.querySelectorAll("[data-field]").forEach(node => {
    const value = get(config, node.dataset.field);
    if (value !== undefined && value !== null) node.textContent = value;
  });
  document.title = `${config.business.name} · Bakery`;
  Object.entries(config.theme || {}).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`, value));
}

function renderMenuExperience(config) {
  const categories = config.menu?.categories || [];
  const filters = document.getElementById("menuFilters");
  const grid = document.getElementById("menuGrid");
  const spotlight = document.getElementById("dishSpotlight");
  const dishes = categories.flatMap((category, categoryIndex) => (category.items || []).map((item, itemIndex) => ({ category, categoryIndex, item, key: `${categoryIndex}-${itemIndex}` })));

  filters.innerHTML = ["All", ...categories.map(category => category.name)].map((name, index) => `<button class="menu-filter${index === 0 ? " is-active" : ""}" type="button" data-category="${index - 1}" aria-pressed="${index === 0}">${escapeHtml(name)}</button>`).join("");
  grid.innerHTML = categories.map((category, categoryIndex) => `<article class="menu-card reveal" data-category="${categoryIndex}"><p class="eyebrow">${escapeHtml(category.name)}</p>${(category.items || []).map((item, itemIndex) => `<button class="menu-item" type="button" data-dish="${categoryIndex}-${itemIndex}" aria-pressed="false"><span class="menu-item-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description)}</span></span><span class="menu-item-price">${escapeHtml(item.price)}</span><span class="menu-item-arrow" aria-hidden="true">↗</span></button>`).join("")}</article>`).join("");

  const spotlightLink = document.getElementById("spotlightLink");
  const whatsappUrl = config.features?.whatsappOrdering ? validatedUrl(config.business?.whatsappLink, WEB_PROTOCOLS) : null;
  if (whatsappUrl) configureLink(spotlightLink, whatsappUrl, WEB_PROTOCOLS);
  else {
    spotlightLink.href = "#contact";
    spotlightLink.textContent = "Find contact options ↗";
  }

  let selectedKey = null;
  function selectDish(key, scrollToSpotlight = false) {
    const selected = dishes.find(dish => dish.key === key);
    if (!selected) return;
    selectedKey = key;
    document.getElementById("spotlightKicker").textContent = selected.category.name;
    document.getElementById("spotlightName").textContent = selected.item.name;
    document.getElementById("spotlightDescription").textContent = selected.item.description;
    document.getElementById("spotlightPrice").textContent = selected.item.price;
    if (whatsappUrl) {
      const link = new URL(whatsappUrl);
      if (["wa.me", "api.whatsapp.com"].includes(link.hostname.toLowerCase())) {
        link.searchParams.set("text", `Hi, I'd like to ask about ${selected.item.name} at ${config.business.name}.`);
      }
      configureLink(spotlightLink, link.href, WEB_PROTOCOLS);
    }
    grid.querySelectorAll("[data-dish]").forEach(button => {
      const active = button.dataset.dish === key;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    spotlight.classList.remove("is-changing");
    // Restart the subtle handoff each time a visitor picks a different dish.
    void spotlight.offsetWidth;
    spotlight.classList.add("is-changing");
    if (scrollToSpotlight && window.matchMedia("(max-width: 780px)").matches) {
      spotlight.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    }
  }

  function selectCategory(categoryIndex) {
    filters.querySelectorAll("[data-category]").forEach(button => {
      const active = Number(button.dataset.category) === categoryIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    grid.querySelectorAll(".menu-card").forEach(card => { card.hidden = categoryIndex !== -1 && Number(card.dataset.category) !== categoryIndex; });
    const current = dishes.find(dish => dish.key === selectedKey);
    if (!current || (categoryIndex !== -1 && current.categoryIndex !== categoryIndex)) {
      const first = dishes.find(dish => categoryIndex === -1 || dish.categoryIndex === categoryIndex);
      if (first) selectDish(first.key);
    }
  }

  filters.addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (button) selectCategory(Number(button.dataset.category));
  });
  grid.querySelectorAll("[data-dish]").forEach(button => {
    button.addEventListener("pointerenter", event => {
      if (event.pointerType === "mouse") selectDish(button.dataset.dish);
    });
    button.addEventListener("focus", () => selectDish(button.dataset.dish));
    button.addEventListener("click", () => selectDish(button.dataset.dish, true));
  });
  if (dishes.length) selectDish(dishes[0].key);
  else spotlight.hidden = true;
  return {
    selectDishByKey(key) {
      const selected = dishes.find(dish => dish.key === key);
      if (!selected) return;
      selectCategory(selected.categoryIndex);
      selectDish(key);
    }
  };
}

function renderHeroSampler(config, menuController) {
  const board = document.getElementById("heroTasting");
  const dishes = (config.menu?.categories || []).flatMap((category, categoryIndex) =>
    (category.items || []).map((item, itemIndex) => ({ category: category.name, item, key: `${categoryIndex}-${itemIndex}` }))
  );
  if (!dishes.length) { board.hidden = true; return; }

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const title = document.getElementById("tastingTitle");
  const body = document.getElementById("tastingBody");
  const progress = document.getElementById("tastingProgress");
  const announce = document.getElementById("tastingAnnounce");
  const quickPicks = document.getElementById("heroQuickPicks");
  const quickPickButtons = dishes.slice(0, 3).map((dish, index) => {
    const button = createTextElement("button", "quick-pick", dish.item.name);
    button.type = "button";
    button.dataset.dishIndex = String(index);
    button.setAttribute("aria-pressed", "false");
    quickPicks.append(button);
    return button;
  });
  let active = 0;
  let timer = null;
  let hovering = false;
  let focused = false;

  function display(index, manual = false) {
    active = (index + dishes.length) % dishes.length;
    const { category, item } = dishes[active];
    document.getElementById("tastingCounter").textContent = `${String(active + 1).padStart(2, "0")} / ${String(dishes.length).padStart(2, "0")}`;
    document.getElementById("tastingCategory").textContent = category;
    title.textContent = item.name;
    document.getElementById("tastingDescription").textContent = item.description;
    document.getElementById("tastingPrice").textContent = item.price;
    board.dataset.taste = String(active % 4);
    quickPickButtons.forEach(button => {
      const selected = Number(button.dataset.dishIndex) === active;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    body.classList.remove("is-changing");
    progress.classList.remove("is-running");
    void body.offsetWidth;
    body.classList.add("is-changing");
    progress.classList.add("is-running");
    if (manual) announce.textContent = `${item.name}, ${item.price}. Dish ${active + 1} of ${dishes.length}.`;
  }

  function schedule() {
    window.clearInterval(timer);
    timer = null;
    const pause = motionPreference.matches || document.hidden || hovering || focused;
    board.classList.toggle("is-paused", pause);
    if (!pause && dishes.length > 1) timer = window.setInterval(() => display(active + 1), 6000);
  }

  document.getElementById("tastingPrevious").addEventListener("click", () => { display(active - 1, true); schedule(); });
  document.getElementById("tastingNext").addEventListener("click", () => { display(active + 1, true); schedule(); });
  quickPickButtons.forEach(button => button.addEventListener("click", () => { display(Number(button.dataset.dishIndex), true); schedule(); }));
  document.getElementById("tastingView").addEventListener("click", () => menuController.selectDishByKey(dishes[active].key));
  board.addEventListener("pointerenter", () => { hovering = true; schedule(); });
  board.addEventListener("pointerleave", () => { hovering = false; schedule(); });
  board.addEventListener("focusin", () => { focused = true; schedule(); });
  board.addEventListener("focusout", event => {
    if (board.contains(event.relatedTarget)) return;
    focused = false;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  motionPreference.addEventListener?.("change", schedule);
  display(0);
  schedule();
}

function render(config) {
  bindFields(config);
  document.getElementById("previewBar").textContent = config.meta.previewLabel;
  document.getElementById("previewBar").hidden = !config.meta.preview;
  document.getElementById("factGrid").innerHTML = config.about.facts.map(fact => `<div><strong>${escapeHtml(fact.value)}</strong><span>${escapeHtml(fact.label)}</span></div>`).join("");
  const menuController = renderMenuExperience(config);
  renderHeroSampler(config, menuController);
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
  observeNavigation();
  if (window.location.hash) {
    let anchor = null;
    try { anchor = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch { /* Ignore malformed URL fragments. */ }
    if (anchor) requestAnimationFrame(() => {
      const previous = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      const headerHeight = document.querySelector(".site-header").getBoundingClientRect().height;
      window.scrollTo({ top: anchor.getBoundingClientRect().top + window.scrollY - headerHeight - 10, behavior: "instant" });
      requestAnimationFrame(() => { document.documentElement.style.scrollBehavior = previous; });
    });
  }
}

function renderReservations(config) {
  const mount = document.getElementById("reservationMount");
  const navigation = document.getElementById("siteNav");
  mount.replaceChildren();
  navigation.querySelector("[data-reservations-nav]")?.remove();
  if (!config.features?.reservations) return;

  const copy = config.reservations || FALLBACK_CONFIG.reservations;
  const section = document.createElement("section");
  section.className = "pre-orders section-shell";
  section.id = "pre-orders";
  const panel = document.createElement("div");
  panel.className = "pre-order-panel reveal";
  const content = document.createElement("div");
  content.append(
    createTextElement("p", "eyebrow", copy.eyebrow),
    createTextElement("h2", "", copy.title),
    createTextElement("p", "pre-order-copy", copy.description),
  );
  const action = createTextElement("a", "button button-light", copy.cta);
  const reservationHref = config.business.reservationLink || config.business.whatsappLink || config.business.phoneLink;
  configureLink(action, reservationHref);
  panel.append(content, action);
  section.append(panel);
  mount.append(section);

  const navLink = createTextElement("a", "", "Pre-orders");
  navLink.href = "#pre-orders";
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

function observeNavigation() {
  const links = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  const sections = links.map(link => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        links.forEach(link => {
          const current = link.getAttribute("href") === `#${entry.target.id}`;
          link.classList.toggle("is-current", current);
          if (current) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-30% 0px -55% 0px" });
    sections.forEach(section => observer.observe(section));
  }

  let scheduled = false;
  const updateProgress = () => {
    const height = document.documentElement.scrollHeight - window.innerHeight;
    document.getElementById("scrollProgress").style.transform = `scaleX(${height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0})`;
    scheduled = false;
  };
  window.addEventListener("scroll", () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateProgress); }
  }, { passive: true });
  updateProgress();
  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener("click", () => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    target.classList.remove("section-arrival");
    void target.offsetWidth;
    target.classList.add("section-arrival");
    window.setTimeout(() => target.classList.remove("section-arrival"), 850);
  }));
}

const toggle = document.querySelector(".menu-toggle");
toggle.addEventListener("click", () => { const open = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!open)); document.getElementById("siteNav").classList.toggle("is-open", !open); });
document.querySelectorAll(".site-nav a").forEach(link => link.addEventListener("click", () => { toggle.setAttribute("aria-expanded", "false"); document.getElementById("siteNav").classList.remove("is-open"); }));
loadConfig().then(render);
