# Tesorería Iglesia 2026 — Fase 1

Proyecto Next.js inicial con navegación, presupuesto y modelo relacional PostgreSQL/Prisma.

## Ejecutar

En esta carpeta: `npm install` y después `npm run dev`. Abra `http://localhost:3000`.

## Fuentes verificadas

- `Presupuesto año 2026.xlsx`: una hoja (`Ppto. 2026`), 26 partidas operativas y cinco categorías. Se preservan los montos mensuales; no se redistribuyen anualmente. Sus filas de subtotal muestran importes con decimales que no se pueden reproducir solo a partir de las partidas visibles; por exactitud, la interfaz suma las partidas operativas y conserva aquellos subtotales como información de origen que debe aclararse antes de una aprobación anual.
- `CARTOLA BANCO ENERO 2026.pdf`: 5 páginas; cargos declarados CLP 4.901.066 y abonos CLP 4.081.007.
- `FINAL CARTOLA ENERO 2026 CONCEPTOS (1).xlsx`: referencia de clasificación humana; no reemplaza la fuente bancaria.

## Diseño de conciliación para Fase 2

Al cargar el PDF se guarda un hash de origen y se calcula un fingerprint por movimiento usando fecha, descripción, cargo/abono, monto y documento. El sistema compara sumas enteras extraídas con los totales declarados. Solo `RECONCILED` habilita un cierre mensual.

## Riesgos técnicos del PDF

Las descripciones se dividen entre líneas y algunas filas cambian de página; por ello, el extractor debe trabajar con coordenadas, continuar filas partidas y dejar el período en revisión si no concilia exactamente.

## Criterios de aceptación

**Fase 1:** importa categorías, partidas y montos mensuales con enteros CLP; permite ver cada mes y el acumulado; el modelo separa presupuesto mensual, transacción bancaria y clasificación.

**Fase 2:** guarda el PDF; bloquea duplicados; extrae fecha, descripción, canal, documento, cargo, abono y saldo sin alterar el original; y para enero exige la conciliación de CLP 4.901.066 en cargos y CLP 4.081.007 en abonos antes del cierre.
