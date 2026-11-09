// popup.js — Calculadora MP V2
const { unirPaginas, sumar, fmt } = window.MPV2Calculo;

const URL_BASE = 'https://www.mercadopago.com.ar/activities';
const MAX_PAGINAS = 20;
const LOTE = 3; // páginas que baja en paralelo el modo rápido

const $ = (id) => document.getElementById(id);
const urlPagina = (p) => (p === 1 ? URL_BASE : `${URL_BASE}?page=${p}`);
const segs = (ms) => (ms / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' s';
const COLOR = { QR: 'var(--c-qr)', Point: 'var(--c-point)', Transferencia: 'var(--c-trans)', Otro: 'var(--c-otro)' };
const NOMBRE = { QR: 'Código QR', Point: 'Point Smart', Transferencia: 'Transferencias', Otro: 'Otros' };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const pad2 = (n) => String(n).padStart(2, '0');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// "sáb 08/11 21:30"
function diaHora(ms) {
  const d = new Date(ms);
  return `${DIAS[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// "dom 8 · 18:00"
function diaCorto(ms) {
  const d = new Date(ms);
  return `${DIAS[d.getDay()]} ${d.getDate()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ── Turno ────────────────────────────────────────────────
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtTime = (d) => d.toTimeString().slice(0, 5);
let hastaEsAhora = true; // si "hasta" es la hora actual, al recalcular se actualiza sola

function ponerAhora() {
  const ahora = new Date();
  $('fecha-hasta').value = fmtDate(ahora);
  $('hora-hasta').value = fmtTime(ahora);
  hastaEsAhora = true;
}

function setDefaults() {
  const ahora = new Date();
  const ayer = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1);
  $('fecha-desde').value = fmtDate(ayer);
  $('hora-desde').value = '18:00';
  ponerAhora();
  try {
    const s = JSON.parse(localStorage.getItem('mpv2-prefs') || '{}');
    if (s.horaDesde) $('hora-desde').value = s.horaDesde;
    if (s.rapido === false) $('modo-rapido').checked = false;
  } catch (e) {}
}

function guardarPrefs() {
  try {
    localStorage.setItem('mpv2-prefs', JSON.stringify({
      horaDesde: $('hora-desde').value,
      rapido: $('modo-rapido').checked,
    }));
  } catch (e) {}
}

function getFiltro() {
  const fd = $('fecha-desde').value, hd = $('hora-desde').value;
  const fh = $('fecha-hasta').value, hh = $('hora-hasta').value;
  if (!fd || !hd || !fh || !hh) return null;
  return { desde: new Date(`${fd}T${hd}:00`).getTime(), hasta: new Date(`${fh}T${hh}:00`).getTime(), fd, hd, fh, hh };
}

// ── UI ───────────────────────────────────────────────────
function vista(cual) {
  $('config').hidden = cual !== 'config';
  $('turno-bar').hidden = cual !== 'resultado';
}
function ocupado(si) {
  $('btn-calcular').disabled = si;
  $('btn-calcular').textContent = si ? 'Calculando…' : 'Calcular turno';
  $('btn-recalcular').disabled = si;
  $('btn-cambiar').disabled = si;
  $('progreso').hidden = !si;
  if (!si) $('progreso-bar').style.width = '0';
}
function avance(pct, txt) {
  $('progreso-bar').style.width = Math.max(4, Math.min(100, pct)) + '%';
  $('progreso-txt').textContent = txt;
}
function aviso(html) { $('warning').innerHTML = html; $('warning').hidden = false; }
function sinAviso() { $('warning').hidden = true; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Chrome ───────────────────────────────────────────────
function navegar(tabId, url, urlActual) {
  return new Promise((resolve) => {
    let vioLoading = false;
    const fin = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); };
    const on = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') vioLoading = true;
      if (info.status === 'complete' && vioLoading) fin();
    };
    const t = setTimeout(fin, 12000);
    chrome.tabs.onUpdated.addListener(on);
    if (urlActual === url) chrome.tabs.reload(tabId, { bypassCache: true });
    else chrome.tabs.update(tabId, { url });
  });
}

async function llamar(tabId, fn, arg) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['parser.js', 'content.js'] });
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (f, a) => window.MPV2[f](a),
    args: [fn, arg],
  });
  return r ? r.result : null;
}

// ── Cálculo ──────────────────────────────────────────────
const alcanzaInicio = (cobros, desde) => cobros.some((c) => c.dt != null && c.dt < desde);
const mismasClaves = (a, b) =>
  a.length === b.length && a.map((c) => c.key).sort().join('\n') === b.map((c) => c.key).sort().join('\n');

async function calcular() {
  sinAviso();
  $('results').hidden = true;
  $('debug').hidden = true;

  const filtro = getFiltro();
  if (!filtro) { aviso('<b>Completá las fechas y horarios</b> del turno.'); vista('config'); return; }
  if (filtro.hasta < filtro.desde) { aviso('<b>"Hasta" es anterior a "Desde".</b> Revisá el horario.'); vista('config'); return; }
  guardarPrefs();

  const t0 = performance.now();
  const ahora = Date.now();
  const rapidoPedido = $('modo-rapido').checked;
  ocupado(true);
  avance(3, 'Abriendo Mercado Pago…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const paginas = [];
  let modo = 'clásico';
  let notaModo = '';
  const ignorados = { egresos: 0, rechazados: 0 };

  // Progreso real: cuánto del turno ya se recorrió (de "ahora" hacia "desde")
  const agregar = (r, nroPag) => {
    paginas.push(r.cobros);
    ignorados.egresos += r.ignorados.egresos;
    ignorados.rechazados += r.ignorados.rechazados;
    const dts = r.cobros.map((c) => c.dt).filter((x) => x != null);
    if (dts.length) {
      const masViejo = Math.min(...dts);
      const pct = ((ahora - masViejo) / Math.max(1, ahora - filtro.desde)) * 100;
      avance(pct, `Página ${nroPag} · ya va por ${diaHora(masViejo)} · ${segs(performance.now() - t0)}`);
    }
  };

  // Página 1: siempre en vivo y recién cargada (igual que la V1)
  await navegar(tab.id, urlPagina(1), tab.url);
  avance(6, 'Leyendo página 1…');
  const r1 = await llamar(tab.id, 'leerEnVivo', { ahora });
  if (!r1 || r1.cobros.length === 0) {
    throw new Error('No se pudieron leer cobros en la página 1. ¿Estás logueado en Mercado Pago? Probá con debug.');
  }
  if (r1.cobros.every((c) => c.dt == null)) {
    throw new Error('No se pudo determinar la fecha de los cobros. Probá con debug.');
  }
  agregar(r1, 1);

  let p = 2;
  let terminado = alcanzaInicio(r1.cobros, filtro.desde);

  // Modo rápido: baja las páginas siguientes en paralelo, pero SOLO si la
  // pág. 1 bajada así da exactamente lo mismo que la pág. 1 real.
  if (!terminado && rapidoPedido) {
    const lote = await llamar(tab.id, 'leerPorFetch', { paginas: [1, 2, 3], ahora });
    if (lote && lote[0] && !lote[0].error && mismasClaves(lote[0].cobros, r1.cobros)) {
      modo = 'rápido';
      let pendientes = lote.slice(1);
      while (!terminado && p <= MAX_PAGINAS) {
        for (const pg of pendientes) {
          if (pg.error) { notaModo = `pág. ${p} leída en modo clásico`; break; }
          if (pg.cobros.length === 0) break; // se confirma en modo clásico
          agregar(pg, p);
          p++;
          if (alcanzaInicio(pg.cobros, filtro.desde)) { terminado = true; break; }
        }
        if (terminado || pendientes.some((pg) => pg.error || pg.cobros.length === 0)) break;
        const sig = Array.from({ length: LOTE }, (_, i) => p + i).filter((n) => n <= MAX_PAGINAS);
        if (!sig.length) break;
        pendientes = await llamar(tab.id, 'leerPorFetch', { paginas: sig, ahora });
      }
    } else {
      notaModo = 'la verificación no coincidió';
    }
  }

  // Modo clásico (o lo que falte): navegar página por página
  while (!terminado && p <= MAX_PAGINAS) {
    await navegar(tab.id, urlPagina(p));
    const r = await llamar(tab.id, 'leerEnVivo', { ahora });
    if (!r || r.cobros.length === 0) break; // fin de la lista
    if (r.cobros.every((c) => c.dt == null)) {
      aviso(`<b>No se pudo leer la fecha</b> de los cobros de la pág. ${p}. El total puede estar incompleto.`);
      break;
    }
    agregar(r, p);
    p++;
    terminado = alcanzaInicio(r.cobros, filtro.desde);
  }

  if (!terminado && p > MAX_PAGINAS) {
    aviso(`<b>Se llegó al límite de ${MAX_PAGINAS} páginas</b> sin alcanzar el inicio del turno. El total puede estar incompleto.`);
  }

  const { cobros, descartados } = unirPaginas(paginas);
  const res = sumar(cobros, filtro.desde, filtro.hasta);
  mostrar(res, { filtro, ms: performance.now() - t0, paginas: paginas.length, modo, notaModo, descartados, ignorados });

  if (res.enRango.length === 0) {
    aviso(`<b>Se leyeron ${cobros.length} movimientos pero ninguno cae en el horario indicado.</b> Revisá fechas y horas.`);
  }
}

// ── Mostrar ──────────────────────────────────────────────
function filaMov(c) {
  return `<div class="mov">
    <span class="h">${esc(c.hora)}</span>
    <span><span class="tag ${c.tipo}">${c.tipo === 'Transferencia' ? 'Transf.' : c.tipo}</span>${c.op ? `<span class="op">#${esc(c.op)}</span>` : ''}</span>
    <span class="m ${c.cent < 0 ? 'neg' : ''}">${c.cent < 0 ? '−' : ''}${fmt(c.cent)}</span>
  </div>`;
}

function mostrar(res, meta) {
  const { rubros, total, devoluciones, totalDevol, enRango } = res;
  const { filtro } = meta;

  $('tb-range').textContent = `${diaCorto(filtro.desde)} → ${diaCorto(filtro.hasta)}`;
  $('tb-range').title = `${diaHora(filtro.desde)} → ${diaHora(filtro.hasta)}`;
  vista('resultado');

  $('total').textContent = (total < 0 ? '−' : '') + fmt(total);
  $('hero-sub').textContent = plural(enRango.length, 'movimiento', 'movimientos') +
    (devoluciones.length ? ` · ${plural(devoluciones.length, 'devolución', 'devoluciones')}` : '');

  const notices = [];
  if (meta.descartados) {
    notices.push(`${plural(meta.descartados, 'movimiento repetido no sumado', 'movimientos repetidos no sumados')}: la lista de MP se corrió mientras se leía.`);
  }
  $('notices').innerHTML = notices.map((n) => `<div class="notice">${esc(n)}</div>`).join('');

  const visibles = ['QR', 'Point', 'Transferencia', 'Otro'].filter((r) => r !== 'Otro' || rubros.Otro.cobros + rubros.Otro.devol > 0);
  const base = visibles.reduce((s, r) => s + Math.max(0, rubros[r].total), 0) || 1;

  $('rows').innerHTML = visibles.map((r) => {
    const x = rubros[r];
    const pct = Math.max(0, (x.total / base) * 100);
    const detalle = plural(x.cobros, 'cobro', 'cobros') +
      (x.devol ? ` · <span class="neg">${plural(x.devol, 'devolución', 'devoluciones')} −${fmt(x.devolTotal)}</span>` : '');
    return `<div class="row">
      <div class="row-top">
        <div class="row-name"><span class="sw" style="background:${COLOR[r]}"></span>${NOMBRE[r]}</div>
        <div class="row-monto num">${x.total < 0 ? '−' : ''}${fmt(x.total)}</div>
      </div>
      <div class="row-meta num"><span>${detalle}</span><span>${Math.round(pct)}%</span></div>
    </div>`;
  }).join('');

  $('devol-box').innerHTML = devoluciones.length ? `<details class="devol">
      <summary><span><b>Devoluciones (${devoluciones.length})</b><small>ya restadas</small></span><span class="num">−${fmt(totalDevol)}</span></summary>
      <div class="devol-list"><div class="devol-note">Cada una ya se restó de su rubro; no se descuentan otra vez del total.</div>${devoluciones.slice().sort((a, b) => a.dt - b.dt).map(filaMov).join('')}</div>
    </details>` : '';

  // Detalle completo, agrupado por día
  const orden = enRango.slice().sort((a, b) => a.dt - b.dt);
  let html = '', dia = '';
  for (const c of orden) {
    const d = new Date(c.dt);
    const etiqueta = `${DIAS[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
    if (etiqueta !== dia) { dia = etiqueta; html += `<div class="detalle-day">${dia}</div>`; }
    html += filaMov(c);
  }
  const ign = [];
  if (meta.ignorados.egresos) ign.push(plural(meta.ignorados.egresos, 'egreso', 'egresos') + ' (transferencias enviadas / compras)');
  if (meta.ignorados.rechazados) ign.push(plural(meta.ignorados.rechazados, 'rechazado o cancelado', 'rechazados o cancelados'));
  if (ign.length) html += `<div class="ign">No se cuentan: ${ign.join(' · ')}.</div>`;
  $('detalle-list').innerHTML = html || '<div class="ign">Sin movimientos.</div>';
  $('detalle-sum').textContent = `Ver los ${enRango.length} movimientos`;
  $('detalle').open = false;

  let m = `${plural(meta.paginas, 'página', 'páginas')} · ${segs(meta.ms)} · `;
  m += meta.modo === 'rápido' ? '<span class="fast">⚡ modo rápido verificado</span>' : 'modo clásico';
  if (meta.notaModo) m += ` (${esc(meta.notaModo)})`;
  $('meta').innerHTML = m;

  $('results').hidden = false;
  window._last = { res, filtro };
}

// ── Eventos ──────────────────────────────────────────────
setDefaults();
$('btn-ahora').addEventListener('click', ponerAhora);
$('fecha-hasta').addEventListener('input', () => { hastaEsAhora = false; });
$('hora-hasta').addEventListener('input', () => { hastaEsAhora = false; });
$('modo-rapido').addEventListener('change', guardarPrefs);

async function correr() {
  try {
    await calcular();
  } catch (e) {
    aviso('<b>Error:</b> ' + esc(e.message));
    vista('config');
  }
  ocupado(false);
}

$('btn-calcular').addEventListener('click', correr);
$('btn-recalcular').addEventListener('click', () => { if (hastaEsAhora) ponerAhora(); correr(); });
$('btn-cambiar').addEventListener('click', () => { vista('config'); $('hora-desde').focus(); });

function marcar(btn, txt) {
  const orig = btn.textContent;
  btn.textContent = txt; btn.classList.add('done');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('done'); }, 1800);
}

$('btn-copy').addEventListener('click', () => {
  const d = window._last; if (!d) return;
  const { rubros, total, devoluciones, totalDevol } = d.res, f = d.filtro;
  const pad = (s) => (s + ':').padEnd(16);
  const lineas = [
    `📊 Turno ${f.fd} ${f.hd}hs → ${f.fh} ${f.hh}hs`,
    '─────────────────────────',
    `${pad('QR')}${fmt(rubros.QR.total)}`,
    `${pad('Point Smart')}${fmt(rubros.Point.total)}`,
    `${pad('Transferencias')}${fmt(rubros.Transferencia.total)}`,
  ];
  if (rubros.Otro.cobros + rubros.Otro.devol > 0) lineas.push(`${pad('Otros')}${fmt(rubros.Otro.total)}`);
  if (devoluciones.length) lineas.push(`${pad('Devoluciones')}-${fmt(totalDevol)} (${devoluciones.length}, ya restadas)`);
  lineas.push('─────────────────────────', `${pad('TOTAL')}${fmt(total)}`);
  navigator.clipboard.writeText(lineas.join('\n')).then(() => marcar($('btn-copy'), '✓ Copiado'));
});

// Mismo formato de token que la V1: CajaSnack lo lee con "Traer de MP".
$('btn-cajasnack').addEventListener('click', () => {
  const d = window._last; if (!d) return;
  const { rubros, total } = d.res, f = d.filtro;
  const pesos = (c) => Math.round(c / 100);
  const payload = {
    qr: pesos(rubros.QR.total),
    point: pesos(rubros.Point.total),
    trans: pesos(rubros.Transferencia.total),
    otros: pesos(rubros.Otro.total),
    mercadoPago: pesos(rubros.QR.total), // "Cobros de MP" = solo QR
    total: pesos(total),
    desde: `${f.fd} ${f.hd}`,
    hasta: `${f.fh} ${f.hh}`,
  };
  navigator.clipboard.writeText('CAJASNACK-MP ' + JSON.stringify(payload))
    .then(() => marcar($('btn-cajasnack'), '✓ Copiado — pegalo en CajaSnack'));
});

$('btn-reset').addEventListener('click', () => {
  $('results').hidden = true;
  sinAviso();
  ponerAhora();
  vista('config');
  window._last = null;
});

$('btn-debug').addEventListener('click', async () => {
  const box = $('debug');
  box.hidden = false;
  box.textContent = 'Leyendo…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('mercadopago.com.ar')) { box.textContent = 'Andá a mercadopago.com.ar/activities primero.'; return; }
  try {
    const { vivo, rapido } = await llamar(tab.id, 'debug', { ahora: Date.now() });
    let out = `PÁGINA EN VIVO · ${vivo.items} items · ${vivo.cobros.length} movimientos · espera ${vivo.esperaMs} ms\n`;
    out += `ignorados: ${JSON.stringify(vivo.ignorados)}\n\n`;
    vivo.cobros.slice(0, 25).forEach((c, i) => {
      out += `[${i}] ${c.tipo} ${c.cent < 0 ? '-' : ''}${fmt(c.cent)} · ${c.fecha || 'SIN FECHA'} ${c.hora || 'SIN HORA'} · op ${c.op || '-'}\n`;
    });
    out += `\nMODO RÁPIDO (pág. 1 bajada): `;
    if (rapido.error) out += `error: ${rapido.error}\n`;
    else {
      out += `${rapido.items} items · ${rapido.cobros.length} movimientos\n`;
      out += mismasClaves(rapido.cobros, vivo.cobros) ? '✓ coincide con la página en vivo → modo rápido disponible\n'
        : '✗ no coincide (si la página en vivo es la pág. 1 recién cargada, se usará modo clásico)\n';
    }
    box.textContent = out;
  } catch (e) {
    box.textContent = 'Error: ' + e.message;
  }
});
