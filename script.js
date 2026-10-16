document.documentElement.classList.add("js");

const root = document.documentElement;
const header = document.querySelector(".site-header");
const themeButton = document.querySelector(".theme-toggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const toast = document.querySelector(".toast");

function setTheme(theme) {
  root.dataset.theme = theme;
  themeButton?.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );
  themeMeta?.setAttribute("content", theme === "dark" ? "#11191d" : "#f4f1ea");
}

setTheme(root.dataset.theme || "light");

themeButton?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
  try {
    localStorage.setItem("theme", nextTheme);
  } catch {
    // The selected theme still applies for this visit when storage is unavailable.
  }
});

const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 16);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

function closeMenu() {
  menuButton?.setAttribute("aria-expanded", "false");
  navigation?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

menuButton?.addEventListener("click", () => {
  const willOpen = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(willOpen));
  navigation?.classList.toggle("is-open", willOpen);
  document.body.classList.toggle("menu-open", willOpen);
});

navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeMenu();
});

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -5% 0px" },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
}

const sectionLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const sections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      sectionLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`);
      });
    },
    { rootMargin: "-20% 0px -65%", threshold: [0, 0.2, 0.6] },
  );
  sections.forEach((section) => sectionObserver.observe(section));
}

let toastTimer;

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await copyText(button.dataset.copy);
      if (!toast) return;
      toast.textContent = "WeChat ID copied · 136 8342 9215";
      toast.classList.add("is-visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
    } catch {
      window.location.href = "tel:+8613683429215";
    }
  });
});

const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());

const visitorToggle = document.querySelector(".visitor-toggle");
const visitorPanel = document.querySelector("#visitor-panel");
const visitorPins = document.querySelector("#visitor-pins");
const visitorTotal = document.querySelector("#visitor-total");
const visitorStatus = document.querySelector("#visitor-status");
const visitorApi = document
  .querySelector('meta[name="visitor-api"]')
  ?.getAttribute("content")
  ?.trim()
  .replace(/\/+$/, "");

const visitorSessionKey = "wenjie-site-visit-recorded";
const svgNamespace = "http://www.w3.org/2000/svg";
let visitorStatsPromise;

function setVisitorPanelOpen(isOpen) {
  if (!visitorToggle || !visitorPanel) return;
  visitorToggle.setAttribute("aria-expanded", String(isOpen));
  visitorPanel.hidden = !isOpen;
  visitorPanel.classList.toggle("is-open", isOpen);
}

visitorToggle?.addEventListener("click", () => {
  const willOpen = visitorToggle.getAttribute("aria-expanded") !== "true";
  setVisitorPanelOpen(willOpen);
  if (willOpen) loadVisitorStats();
});

function wasVisitRecorded() {
  try {
    return sessionStorage.getItem(visitorSessionKey) === visitorApi;
  } catch {
    return false;
  }
}

function rememberRecordedVisit() {
  try {
    sessionStorage.setItem(visitorSessionKey, visitorApi);
  } catch {
    // The in-page promise still prevents duplicate requests when storage is blocked.
  }
}

async function requestVisitorStats(path, method = "GET") {
  const response = await fetch(`${visitorApi}${path}`, {
    method,
    headers: { Accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: method === "POST" ? "no-store" : "default",
  });

  if (!response.ok) throw new Error(`Visitor API returned ${response.status}`);

  const payload = await response.json();
  if (!payload || !Number.isFinite(Number(payload.total)) || !Array.isArray(payload.pins)) {
    throw new Error("Visitor API returned an invalid response");
  }
  return payload;
}

async function fetchVisitorStats() {
  if (wasVisitRecorded()) return requestVisitorStats("/stats");

  try {
    const stats = await requestVisitorStats("/visit", "POST");
    rememberRecordedVisit();
    return stats;
  } catch {
    // A failed write should not prevent the public aggregate map from loading.
    return requestVisitorStats("/stats");
  }
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function normalizeVisitorPins(pins) {
  return pins
    .map((pin) => ({
      lat: Number(pin.lat),
      lng: Number(pin.lng),
      count: Math.max(0, Math.round(Number(pin.count))),
      country: /^[A-Z]{2}$/.test(String(pin.country || "").toUpperCase())
        ? String(pin.country).toUpperCase()
        : "XX",
    }))
    .filter(
      (pin) =>
        Number.isFinite(pin.lat) &&
        Number.isFinite(pin.lng) &&
        pin.lat >= -90 &&
        pin.lat <= 90 &&
        pin.lng >= -180 &&
        pin.lng <= 180 &&
        pin.count > 0,
    );
}

function renderVisitorStats(stats) {
  if (!visitorPins || !visitorTotal || !visitorStatus) return;

  const pins = normalizeVisitorPins(stats.pins);
  const maximumCount = Math.max(1, ...pins.map((pin) => pin.count));
  const fragment = document.createDocumentFragment();

  pins.forEach((pin) => {
    const x = ((pin.lng + 180) / 360) * 1000;
    const y = ((90 - pin.lat) / 180) * 500;
    const radius = 6 + 9 * Math.sqrt(pin.count / maximumCount);
    const countryLabel = pin.country === "XX" ? "Unknown region" : pin.country;
    const visitLabel = `${pin.count.toLocaleString("en-US")} ${pin.count === 1 ? "visit" : "visits"}`;
    const group = createSvgElement("g", {
      class: "visitor-pin",
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
      role: "img",
      "aria-label": `${countryLabel}, ${visitLabel}`,
    });
    const title = createSvgElement("title");
    const circle = createSvgElement("circle", { r: radius.toFixed(2) });
    const label = createSvgElement("text", {
      x: 0,
      y: (radius + 13).toFixed(2),
      "text-anchor": "middle",
    });

    title.textContent = `${countryLabel} · ${visitLabel}`;
    label.textContent = pin.count.toLocaleString("en-US");
    group.append(title, circle, label);
    fragment.append(group);
  });

  visitorPins.replaceChildren(fragment);
  visitorTotal.textContent = Math.max(0, Math.round(Number(stats.total))).toLocaleString("en-US");

  if (pins.length === 0) {
    visitorStatus.textContent = "Visits are being counted; no coarse locations are available yet.";
  } else {
    const precision = Number(stats.precisionDegrees);
    visitorStatus.textContent = Number.isFinite(precision)
      ? `${pins.length.toLocaleString("en-US")} anonymous locations · ${precision}° grid`
      : `${pins.length.toLocaleString("en-US")} anonymous visitor locations`;
  }
}

function showVisitorError() {
  visitorPins?.replaceChildren();
  if (visitorTotal) visitorTotal.textContent = "—";
  if (visitorStatus) visitorStatus.textContent = "Visitor statistics are temporarily unavailable.";
}

function loadVisitorStats() {
  if (!visitorApi) {
    if (visitorStatus) {
      visitorStatus.textContent = "Visitor statistics will appear once the analytics endpoint is connected.";
    }
    return Promise.resolve(null);
  }

  if (visitorStatsPromise) return visitorStatsPromise;
  visitorPanel?.setAttribute("aria-busy", "true");
  if (visitorStatus) visitorStatus.textContent = "Loading anonymous visitor locations…";

  visitorStatsPromise = fetchVisitorStats()
    .then((stats) => {
      renderVisitorStats(stats);
      return stats;
    })
    .catch(() => {
      showVisitorError();
      return null;
    })
    .finally(() => visitorPanel?.removeAttribute("aria-busy"));

  return visitorStatsPromise;
}

// Record this page entry immediately; expanding the footer reuses the result.
if (visitorApi) loadVisitorStats();
