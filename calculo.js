// calculo.js — Calculadora MP V2
// Une las páginas leídas y suma por rubro. Todo en centavos enteros.
// (Sin dependencias del navegador: se puede probar con Node.)

(function (global) {
  // Si entra un cobro nuevo mientras se pagina, MP corre la lista y los
  // últimos movimientos de la pág. N reaparecen al principio de la pág. N+1.
  // La V1 los sumaba dos veces. Acá se detecta ese corrimiento (el final de
  // una página repetido, en el mismo orden, al comienzo de la siguiente) y
  // además nunca se cuenta dos veces el mismo nº de operación.
  function unirPaginas(paginas) {
    const out = [];
    const ops = new Set();
    let descartados = 0;
    let prev = [];
    for (const pg of paginas) {
      let k = 0;
      for (let n = Math.min(10, prev.length, pg.length); n > 0; n--) {
        let igual = true;
        for (let i = 0; i < n; i++) {
          if (prev[prev.length - n + i].key !== pg[i].key) { igual = false; break; }
        }
        if (igual) { k = n; break; }
      }
      descartados += k;
      for (const c of pg.slice(k)) {
        if (c.op) {
          if (ops.has(c.op)) { descartados++; continue; }
          ops.add(c.op);
        }
        out.push(c);
      }
      prev = pg;
    }
    return { cobros: out, descartados };
  }

  const RUBROS = ['QR', 'Point', 'Transferencia', 'Otro'];

  // Mismas reglas que la V1: cada movimiento suma (o resta, si es negativo)
  // en su propio rubro. Las transferencias negativas ya vienen descartadas.
  function sumar(cobros, desde, hasta) {
    const enRango = cobros.filter((c) => c.dt != null && c.dt >= desde && c.dt <= hasta);
    const rubros = {};
    for (const r of RUBROS) rubros[r] = { total: 0, cobros: 0, devol: 0, devolTotal: 0 };
    for (const c of enRango) {
      const r = rubros[c.tipo] || rubros.Otro;
      r.total += c.cent;
      if (c.cent < 0) { r.devol++; r.devolTotal += c.cent; } else r.cobros++;
    }
    const devoluciones = enRango.filter((c) => c.cent < 0 && c.tipo !== 'Transferencia');
    const total = RUBROS.reduce((s, r) => s + rubros[r].total, 0);
    const totalDevol = devoluciones.reduce((s, c) => s + c.cent, 0);
    return { enRango, rubros, total, devoluciones, totalDevol };
  }

  // $ 1.234.567,89 — exacto, a partir de centavos enteros
  function fmt(cent) {
    const abs = Math.abs(Math.round(cent));
    const ent = Math.floor(abs / 100).toLocaleString('es-AR');
    return '$' + ent + ',' + String(abs % 100).padStart(2, '0');
  }

  const api = { unirPaginas, sumar, fmt, RUBROS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MPV2Calculo = api;
})(typeof window !== 'undefined' ? window : globalThis);
