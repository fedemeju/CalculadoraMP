// parser.js — Calculadora MP V2
// Lee los movimientos de la página de Actividades de Mercado Pago.
//
// Mismos criterios de suma y resta que la V1 (content.js v10.6):
//  · Manda el SIGNO del monto, no el nombre (MP cambia seguido cómo llama
//    a las devoluciones: "Devuelto parcial", "Devolución de dinero", etc.).
//  · Devoluciones de venta (QR / Point en negativo) restan de SU PROPIO rubro.
//  · Egresos que NO son devoluciones de venta (transferencias enviadas,
//    "Compra", pagos) se IGNORAN: ni suman ni restan.
//  · Transferencias recibidas (+) suman.
//  · Rechazados / cancelados no cuentan.
//
// Mejoras de exactitud respecto de la V1:
//  · Montos en CENTAVOS enteros (sin errores de coma flotante).
//  · Entiende montos con separador de miles ("45.000", "1.234,50").
//  · "31 de diciembre" leído en enero cae en el año anterior.
//  · La clave anti-duplicados incluye la fecha (dos cobros iguales de
//    distintos días ya no se pisan).

(function () {
  if (window.MPV2Parser) return;

  const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };

  const inicioDelDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const pad2 = (n) => String(n).padStart(2, '0');

  // "Hoy" · "Ayer" · "10 de octubre" · "10 de octubre de 2025"
  function parsearFechaLinea(linea, ahora) {
    const t = (linea || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t || t.length > 30) return null;
    const hoy = inicioDelDia(ahora);
    if (t === 'hoy') return hoy;
    if (t === 'ayer') return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    const m = t.match(/^(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/);
    if (!m) return null;
    const mes = MESES[m[2]];
    if (!mes) return null;
    const dia = parseInt(m[1], 10);
    const anio = m[3] ? parseInt(m[3], 10) : hoy.getFullYear();
    let f = new Date(anio, mes - 1, dia);
    if (f.getMonth() !== mes - 1) return null; // fecha imposible
    if (!m[3] && f > hoy) f = new Date(anio - 1, mes - 1, dia);
    return f;
  }

  // Mismo criterio que la V1
  function getTipo(texto) {
    if (/QR/i.test(texto)) return 'QR';
    if (/Point/i.test(texto)) return 'Point';
    if (/transferencia|dinero recibido|dinero enviado/i.test(texto)) return 'Transferencia';
    return null;
  }

  // "45000" · "47,03" · "45.000" · "1.234,50" · "1,234.50"  →  centavos enteros
  function aCentavos(numStr) {
    let s = numStr.replace(/[.,]+$/, '');
    const coma = s.includes(','), punto = s.includes('.');
    if (coma && punto) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')   // 1.234,50
        : s.replace(/,/g, '');                     // 1,234.50
    } else if (coma) {
      s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (punto) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 45.000 = miles
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [ent, dec = ''] = s.split('.');
    return parseInt(ent, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  }

  // aria-label del monto: "+45000 pesos" / "-47,03 pesos" / "+47 pesos con 3 centavos"
  function leerMonto(ariaLabel) {
    const mm = ariaLabel.match(/([-+−]?)(\d[\d.,]*)\s*pesos?/i);
    if (!mm) return null;
    let cent = aCentavos(mm[2]);
    if (cent === null) return null;
    const cc = ariaLabel.match(/pesos?\s+con\s+(\d{1,2})\s*centavos?/i);
    if (cc && cent % 100 === 0) cent += parseInt(cc[1], 10);
    const negativo = mm[1] === '-' || mm[1] === '−';
    return { cent: negativo ? -cent : cent, conSigno: mm[1] !== '' };
  }

  function esVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // Método de la V1: fecha por nº de operación usando el texto renderizado.
  // Solo sirve en la página en vivo (innerText necesita layout).
  function fechasPorOperacion(doc, ahora) {
    const lineas = (doc.body.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const mapa = {};
    let actual = null;
    for (const l of lineas) {
      const f = parsearFechaLinea(l, ahora);
      if (f) { actual = f; continue; }
      const mOp = l.match(/Operaci[oó]n\s+(\d+)/i);
      if (mOp && actual) mapa[mOp[1]] = actual;
    }
    return mapa;
  }

  // Fecha del encabezado de día bajo el que aparece cada item (recorrido en
  // orden de documento, igual que la V1). Funciona también sin layout.
  function fechasPorItem(raiz, items, ahora) {
    const set = new Set(items);
    const res = new Map();
    let actual = null;
    const doc = raiz.ownerDocument || raiz;
    const tw = doc.createTreeWalker(raiz, 1 /* SHOW_ELEMENT */);
    let node = tw.currentNode;
    while (node) {
      if (node.nodeType === 1) {
        let propio = '';
        for (const ch of node.childNodes) if (ch.nodeType === 3) propio += ch.textContent;
        const f = parsearFechaLinea(propio, ahora);
        if (f) actual = f;
        if (set.has(node) && actual && !res.has(node)) res.set(node, actual);
      }
      node = tw.nextNode();
    }
    return res;
  }

  // Lee un documento (la página en vivo o un HTML bajado con fetch).
  function leerDocumento(doc, opts) {
    const ahora = new Date(opts.ahora || Date.now());
    const raiz = doc.body || doc.documentElement;
    let items = Array.from(raiz.querySelectorAll('.andes-ui-list__item'));
    if (opts.visibleOnly) items = items.filter(esVisible);

    const porOp = opts.visibleOnly ? fechasPorOperacion(doc, ahora) : {};
    const porItem = fechasPorItem(raiz, items, ahora);

    const cobros = [];
    const vistos = new Set();
    const ign = { sinTipo: 0, rechazados: 0, egresos: 0, sinMonto: 0, repetidos: 0 };

    for (const item of items) {
      const texto = item.textContent || '';
      const tipo = getTipo(texto);
      if (!tipo) { ign.sinTipo++; continue; }
      if (/rechazado|cancelado/i.test(texto)) { ign.rechazados++; continue; }

      const montoEl = item.querySelector('[aria-label*="peso"]');
      const aria = montoEl ? montoEl.getAttribute('aria-label') || '' : '';
      const monto = aria ? leerMonto(aria) : null;
      if (!monto || monto.cent === 0) { ign.sinMonto++; continue; }

      let cent = monto.cent;
      // Respaldo de la V1: si el aria-label viniera sin signo, se deduce del texto
      if (cent > 0) {
        const dicenMenos = /\bmenos\b/i.test(aria) ||
          /devoluci[oó]n|devuelt[oa]|reintegro|reembolso|contracargo/i.test(texto);
        if (dicenMenos) cent = -cent;
      }

      // Egreso que no es devolución de venta → se ignora
      if (cent < 0 && tipo === 'Transferencia') { ign.egresos++; continue; }

      const opM = texto.match(/Operaci[oó]n\s+(\d+)/i);
      const op = opM ? opM[1] : null;
      const fecha = (op && porOp[op]) || porItem.get(item) || null;

      let hora = null;
      const hm = texto.match(/(\d{1,2}):(\d{2})(?:\s*hs)?/i);
      if (hm) {
        const h = parseInt(hm[1], 10), m = parseInt(hm[2], 10);
        if (h < 24 && m < 60) hora = { h, m };
      }

      const dt = fecha && hora
        ? new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), hora.h, hora.m, 0).getTime()
        : null;

      const fechaTxt = fecha ? `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(fecha.getDate())}` : '';
      const horaTxt = hora ? `${pad2(hora.h)}:${pad2(hora.m)}` : '';
      const key = `${tipo}|${cent}|${fechaTxt}|${horaTxt}|${op || ''}`;
      if (vistos.has(key)) { ign.repetidos++; continue; }
      vistos.add(key);

      cobros.push({ tipo, cent, dt, fecha: fechaTxt, hora: horaTxt, op, key });
    }

    return { cobros, items: items.length, ignorados: ign };
  }

  window.MPV2Parser = { leerDocumento, parsearFechaLinea, aCentavos, leerMonto, getTipo };
})();
