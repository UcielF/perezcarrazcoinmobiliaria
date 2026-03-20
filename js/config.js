/* ============================================================
   app.js  –  Perez Carrazco Inmobiliaria
   Datos: Tokko Broker vía Cloudflare Worker
   ============================================================ */

const PROXY    = "https://tokko-proxy.tecno-serv00.workers.dev";
const OP_LABEL = { 1: "Venta", 2: "Alquiler", 3: "Temporario" };
const OP_MAP   = { venta: 1, alquiler: 2, temporario: 3 };
const ROOT     = window.ROOT_PATH || "";

const state = {
  allProps: [],   // todas las props cargadas (para filtrar)
  props:    [],
  page:     1,
  limit:    9,
  loading:  false,
  opType:   null,  // null = todos | 1 = venta | 2 = alquiler | 3 = temporario
  allLoaded: false // true cuando se cargaron todas las páginas
};

// ── Utilidades ────────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);

function escHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function portada(p) {
  const front = p?.photos?.find(ph => ph.is_front_cover);
  return front?.image
    || p?.photos?.[0]?.image
    || "https://placehold.co/800x450?text=Sin+imagen";
}

function fmtPrecio(p) {
  const price = p?.operations?.[0]?.prices?.[0];
  if (!price?.price) return "Consultar";
  return `${price.currency || "U$S"} ${Number(price.price).toLocaleString("es-AR")}`;
}

function metaTexto(p) {
  const sup = parseFloat(p?.roofed_surface) || parseFloat(p?.total_surface) || null;
  return [
    p?.room_amount     && `${p.room_amount} amb.`,
    sup                && `${sup} m²`,
    p?.bathroom_amount && `${p.bathroom_amount} baño${p.bathroom_amount > 1 ? "s" : ""}`
  ].filter(Boolean).join(" • ");
}

function opBadge(p) {
  const opType = p?.operations?.[0]?.operation_type;
  return opType ? `<span class="badge">${opType}</span>` : "";
}

function cardHtml(p) {
  const id    = p.id ?? p.property_id;
  const title = escHtml(p.publication_title || p.address || "Propiedad");
  const img   = portada(p);

  return `
    <article class="card">
      <a href="${ROOT}propiedad.html?id=${id}" class="card-img-wrap">
        <img src="${img}" alt="${title}" class="card-img" loading="lazy">
        <div class="card-price-overlay">
          <span class="card-price">${fmtPrecio(p)}</span>
        </div>
        ${opBadge(p)}
      </a>
      <div class="card-body">
        <h3 class="card-title">${title}</h3>
        <p class="card-meta">${metaTexto(p) || "&nbsp;"}</p>
        <a href="${ROOT}propiedad.html?id=${id}" class="btn-outline">Ver propiedad →</a>
      </div>
    </article>`;
}

// ── Fetch Tokko ───────────────────────────────────────────────────────────────

async function fetchProps(page = 1, limit = 9, opType = null) {
  let url = `${PROXY}/property?page=${page}&limit=${limit}`;
  if (opType) url += `&operation_types=${opType}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.objects || data.results || [];
}

// Carga todas las páginas en background para poder filtrar
async function precargarTodas() {
  if (state.allLoaded || state.loading) return;
  let pg = 1;
  const limit = 100;
  while (true) {
    let url = `${PROXY}/property?page=${pg}&limit=${limit}`;
    if (state.opType) url += `&operation_types=${state.opType}`;
    try {
      const r = await fetch(url);
      if (!r.ok) break;
      const data = await r.json();
      const items = data.objects || data.results || [];
      if (!items.length) break;
      // Agregar solo las que no están ya
      const ids = new Set(state.allProps.map(p => p.id ?? p.property_id));
      items.forEach(p => { if (!ids.has(p.id ?? p.property_id)) state.allProps.push(p); });
      if (items.length < limit) break;
      pg++;
    } catch { break; }
  }
  state.allLoaded = true;
}

// ── Render grilla principal ───────────────────────────────────────────────────

async function cargarDisponibles(append = false) {
  if (state.loading) return;
  state.loading = true;

  const grid = document.getElementById("grid-disponibles");
  if (!grid) { state.loading = false; return; }

  if (!append) grid.innerHTML = "<p>Cargando propiedades…</p>";

  try {
    let items = await fetchProps(state.page, state.limit, state.opType);

    state.props.push(...items);
    // Acumular en allProps para búsqueda
    const ids = new Set(state.allProps.map(p => p.id ?? p.property_id));
    items.forEach(p => { if (!ids.has(p.id ?? p.property_id)) state.allProps.push(p); });

    const html = items.map(cardHtml).join("");
    if (append) {
      grid.insertAdjacentHTML("beforeend", html);
    } else {
      grid.innerHTML = html || "<p>No hay propiedades disponibles en este momento.</p>";
    }

    // Ocultar "Ver más" si no hay más páginas
    if (items.length < state.limit) {
      document.getElementById("ver-mas")?.style.setProperty("display", "none");
    }
  } catch (e) {
    console.error("[app] Error al cargar propiedades:", e);
    if (!append) grid.innerHTML = "<p>Error al cargar propiedades. Intentá de nuevo.</p>";
  } finally {
    state.loading = false;
  }
}

// ── Búsqueda (client-side sobre props ya cargadas) ────────────────────────────

function getPrecio(p) {
  return parseFloat(p?.operations?.[0]?.prices?.[0]?.price) || null;
}

function getOpLabel(p) {
  return (p?.operations?.[0]?.operation_type || "").toLowerCase();
}

function aplicarFiltros() {
  const q     = ($('#q')?.value || "").trim().toLowerCase();
  const tipo  = ($('#tipo')?.value || "").toLowerCase();
  const pMin  = parseFloat($('#precioMin')?.value);
  const pMax  = parseFloat($('#precioMax')?.value);
  const opStr = ($('#operacion')?.value || "").toLowerCase();

  return state.allProps.filter(p => {
    // Filtro operación: compara contra operation_type (string de Tokko)
    if (opStr) {
      const pOp = getOpLabel(p);
      if (!pOp.includes(opStr)) return false;
    }

    // Filtro tipo de propiedad
    if (tipo) {
      const pTipo = (p.property_type?.name || p.type || "").toLowerCase();
      if (!pTipo.includes(tipo)) return false;
    }

    // Filtro precio usando la estructura real de Tokko
    const precio = getPrecio(p);
    if (Number.isFinite(pMin) && (precio === null || precio < pMin)) return false;
    if (Number.isFinite(pMax) && (precio === null || precio > pMax)) return false;

    // Filtro texto libre
    if (q) {
      const texto = [p.publication_title, p.address, p.neighborhood, p.description]
        .filter(Boolean).join(" ").toLowerCase();
      if (!texto.includes(q)) return false;
    }

    return true;
  });
}

function renderResultados(lista) {
  const grid    = document.getElementById("gridResultados");
  const counter = document.getElementById("contadorResultados");
  if (!grid) return;

  if (counter) {
    counter.textContent = lista.length
      ? `${lista.length} resultado(s)`
      : "Sin resultados para los filtros aplicados.";
  }
  grid.innerHTML = lista.map(cardHtml).join("");
  document.getElementById("listado")?.scrollIntoView({ behavior: "smooth" });
}

// ── Navegación: header sticky con scroll ─────────────────────────────────────

function initStickyHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ── Navegación: subheader + submenús ─────────────────────────────────────────

function initNav() {
  const toggle   = document.querySelector('.nav-toggle');
  const mobileNav = document.getElementById('nav-mobile');
  const overlay   = document.getElementById('navOverlay');

  if (!toggle || !mobileNav) return;

  toggle.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggle.querySelector('i').className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    overlay?.classList.toggle('is-open', open);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-toggle') && !e.target.closest('#nav-mobile')) {
      mobileNav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      mobileNav.setAttribute('aria-hidden', 'true');
      toggle.querySelector('i').className = 'fa-solid fa-bars';
      overlay?.classList.remove('is-open');
    }
  }, { passive: true });
}

function initSubmenus() {
  document.querySelectorAll(".has-submenu").forEach(li => {
    const btn = li.querySelector(".submenu-toggle");
    if (!btn) return;
    btn.type = "button";

    btn.addEventListener("click", () => {
      const open = !li.classList.contains("open");
      li.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  document.addEventListener("click", e => {
    const opened = document.querySelector(".has-submenu.open");
    if (opened && !opened.contains(e.target)) {
      opened.classList.remove("open");
      opened.querySelector(".submenu-toggle")?.setAttribute("aria-expanded", "false");
    }
  }, { passive: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const anioEl = document.getElementById("anio");
  if (anioEl) anioEl.textContent = new Date().getFullYear();

  initStickyHeader();
  initNav();
  initSubmenus();

  const grid = document.getElementById("grid-disponibles");
  if (grid) {
    const opAttr = grid.dataset.op;
    state.opType = opAttr ? parseInt(opAttr, 10) : null;

    await cargarDisponibles();

    document.getElementById("ver-mas")?.addEventListener("click", () => {
      state.page++;
      cargarDisponibles(true);
    });
  }

  const buscador = document.getElementById("buscador");
  if (buscador) {
    buscador.addEventListener("submit", async e => {
      e.preventDefault();
      const grid = document.getElementById("gridResultados");
      if (grid) grid.innerHTML = "<p>Buscando…</p>";
      // Precargar todas las props para filtrar correctamente
      if (!state.allLoaded) await precargarTodas();
      renderResultados(aplicarFiltros());
    });

    // Resetear resultados si se borran todos los filtros
    buscador.addEventListener("reset", () => {
      const grid = document.getElementById("gridResultados");
      const counter = document.getElementById("contadorResultados");
      if (grid) grid.innerHTML = "";
      if (counter) counter.textContent = "";
    });
  }
});
