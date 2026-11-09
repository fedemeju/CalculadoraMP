// content.js — Calculadora MP V2
// Se inyecta en la pestaña de Mercado Pago (junto con parser.js) y expone
// window.MPV2 para que el popup lo llame con chrome.scripting.executeScript.

(function () {
  if (window.MPV2) return;
  const P = window.MPV2Parser;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function itemsVisibles() {
    let n = 0;
    for (const el of document.querySelectorAll('.andes-ui-list__item')) {
      if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) n++;
    }
    return n;
  }

  // En vez de esperar un tiempo fijo (V1: 1,2 s + 0,4 s por página), espera
  // a que la lista aparezca y deje de cambiar. Apenas está quieta, lee.
  function esperarLista({ timeout = 9000, quieto = 350 } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let ultimoCambio = Date.now();
      let ultimoN = -1;
      const obs = new MutationObserver(() => { ultimoCambio = Date.now(); });
      obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      const tick = () => {
        const n = itemsVisibles();
        if (n !== ultimoN) { ultimoN = n; ultimoCambio = Date.now(); }
        const ahora = Date.now();
        const listo = n > 0 && ahora - ultimoCambio >= quieto && document.readyState !== 'loading';
        if (listo || ahora - t0 > timeout) {
          obs.disconnect();
          resolve({ items: n, ms: ahora - t0 });
        } else setTimeout(tick, 60);
      };
      tick();
    });
  }

  async function leerEnVivo({ ahora }) {
    const espera = await esperarLista();
    const r = P.leerDocumento(document, { visibleOnly: true, ahora });
    return { ...r, url: location.href, esperaMs: espera.ms };
  }

  // Modo rápido: baja el HTML de las páginas en paralelo, sin navegar.
  async function bajarPagina(pagina, ahora) {
    const url = pagina === 1 ? '/activities' : `/activities?page=${pagina}`;
    try {
      const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!resp.ok) return { pagina, error: `HTTP ${resp.status}` };
      if (resp.redirected && !/\/activities/.test(resp.url)) return { pagina, error: 'redirigido' };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { pagina, ...P.leerDocumento(doc, { visibleOnly: false, ahora }) };
    } catch (e) {
      return { pagina, error: e.message };
    }
  }

  async function leerPorFetch({ paginas, ahora }) {
    return Promise.all(paginas.map((p) => bajarPagina(p, ahora)));
  }

  async function debug({ ahora }) {
    const vivo = await leerEnVivo({ ahora });
    const rapido = await bajarPagina(1, ahora);
    return { vivo, rapido };
  }

  window.MPV2 = { leerEnVivo, leerPorFetch, debug, sleep };
})();
