# Reportabilidad financiera

## Regla de publicación

Los informes oficiales solo presentan períodos con cartola conciliada, todas las clasificaciones confirmadas y cierre mensual realizado. Un período reabierto deja de ser definitivo hasta que vuelva a cerrarse.

## Indicadores oficiales

| Indicador | Definición |
| --- | --- |
| Ingresos totales | Suma de los abonos clasificados del período. |
| Gastos totales | Suma de los cargos clasificados del período. |
| Saldo operativo | Ingresos totales menos gastos totales. |
| Diezmos, ofrendas y misiones | Suma de cada concepto de ingreso confirmado. |
| Total imponible | Diezmos más ofrendas. |
| Aporte 15% | Total imponible multiplicado por 15%. |
| Aporte 1% | Total imponible multiplicado por 1%. |
| Total 16% | Aporte 15% más aporte 1%. |
| Ejecución presupuestaria | Gastos totales divididos por presupuesto del mes. |

## Informes de miembros

Los listados de diezmadores, miembros y aportantes de misiones usan el nombre validado mediante **Editar nombre** en cada movimiento. Si no hay un nombre validado, el reporte lo muestra como **Sin nombre asignado** y lo alerta como pendiente de identificación; nunca inventa un nombre a partir del texto bancario.

Las exportaciones generan un libro `.xlsx` por período, con montos en CLP y columnas suficientes para auditoría: fecha, nombre, concepto, descripción y monto.

## Controles de integridad

- Cada transacción se considera una sola vez: si está dividida, se suman sus asignaciones; si no, se usa su clasificación única.
- Los totales de conceptos, los totales de miembros y los gráficos provienen de la misma base de movimientos.
- Los presupuestos se comparan contra la fuente 2026 y se bloquea el cierre ante una diferencia.
- Los meses cerrados se protegen; una corrección exige reapertura controlada, contraseña de la tesorera y motivo de auditoría.
