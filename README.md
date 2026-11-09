# Calculadora MP V2

Extensión de Chrome que suma los cobros de Mercado Pago de un turno (QR, Point y transferencias) para cuadrar la caja del Snack.

## Instalar

1. Abrir `chrome://extensions` y activar **Modo de desarrollador**.
2. **Cargar descomprimida** → elegir esta carpeta.
3. Fijar el ícono en la barra de Chrome.

## Usar

1. Elegir el horario del turno (por defecto: ayer 18:00 → ahora).
2. **Calcular turno**. La extensión abre Mercado Pago → Actividades y lee las páginas necesarias.
3. **Copiar para CajaSnack** y pegarlo en CajaSnack con "Traer de MP".

## Reglas de suma y resta

- Manda el **signo** del monto, no el nombre del movimiento.
- Las devoluciones de venta (QR / Point en negativo) se restan de su propio rubro.
- Los egresos que no son devoluciones (transferencias enviadas, compras) no se cuentan.
- Las transferencias recibidas suman.
- Los rechazados y cancelados no se cuentan.
- Todo se suma en centavos enteros.

## Modo rápido

Lee las páginas siguientes en segundo plano, en paralelo, **solo si** la página 1 leída así coincide exactamente con la página 1 real. Si no coincide, lee página por página (modo clásico). Si la lista de Mercado Pago se corre mientras se lee, los movimientos repetidos se descartan y se avisa.

## Archivos

- `parser.js` — lee los movimientos de la página de Actividades.
- `content.js` — se inyecta en la pestaña de Mercado Pago (espera de la lista y modo rápido).
- `calculo.js` — une las páginas y suma por rubro.
- `popup.html` / `popup.js` — la ventanita de la extensión.
