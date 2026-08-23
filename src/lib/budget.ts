export const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;
export type BudgetItem = { category: string; item: string; amounts: readonly (number | null)[] };

// Exact operational lines from “Presupuesto año 2026.xlsx”. Null preserves an empty source cell.
export const INITIAL_BUDGET: readonly BudgetItem[] = [
  { category:"Asignacion ministerial", item:"Asignación Pastoral", amounts:[1120000,1120000,1120000,1120000,1120000,1120000,1120000,1120000,1120000,1120000,1120000,1120000] },
  { category:"Asignacion ministerial", item:"Imposiciones", amounts:[300000,300000,300000,300000,300000,300000,300000,300000,300000,300000,300000,300000] },
  { category:"Asignacion ministerial", item:"Casa Pastoral gastos basicos", amounts:[250000,250000,250000,250000,250000,250000,250000,250000,250000,250000,250000,250000] },
  { category:"Asignacion ministerial", item:"Casa Pastoral arriendo", amounts:[611841,611841,611841,611841,611841,611841,611841,611841,611841,611841,611841,611841] },
  { category:"Asignacion ministerial", item:"Bencina", amounts:[140000,140000,140000,140000,140000,140000,140000,140000,140000,140000,140000,140000] },
  { category:"Asignacion ministerial", item:"Seguro Medico", amounts:[45000,45000,45000,45000,45000,45000,45000,45000,45000,45000,45000,45000] },
  { category:"Asignacion ministerial", item:"Ahorro vivienda pastoral", amounts:[40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000] },
  { category:"Asignacion ministerial", item:"Aporte Vacaciones", amounts:[500000,0,0,0,0,0,0,0,null,0,0,0] },
  { category:"Asignacion ministerial", item:"Aporte Fiestas Patrias", amounts:[null,0,0,0,0,0,0,0,100000,0,0,0] },
  { category:"Asignacion ministerial", item:"Aporte Navidad", amounts:[0,0,0,0,0,0,0,0,0,0,0,100000] },
  { category:"Gastos administrativos", item:"Aporte 1% Plantacion de Iglesia", amounts:[40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000] },
  { category:"Gastos administrativos", item:"Aporte 1% Hogar de Niñas", amounts:[40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000] },
  { category:"Gastos administrativos", item:"15% Aporte", amounts:[600000,600000,600000,600000,600000,600000,600000,600000,600000,600000,600000,600000] },
  { category:"Gastos Generales", item:"Seguro Verisur", amounts:[75000,75000,75000,75000,75000,75000,75000,75000,75000,75000,75000,75000] },
  { category:"Gastos Generales", item:"Mantencion General", amounts:[100000,100000,100000,100000,100000,100000,100000,100000,100000,100000,100000,100000] },
  { category:"Gastos Generales", item:"Agua", amounts:[35000,35000,35000,35000,35000,35000,35000,35000,35000,35000,35000,35000] },
  { category:"Gastos Generales", item:"Luz", amounts:[40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000,40000] },
  { category:"Gastos Generales", item:"Internet", amounts:[25000,25000,25000,25000,25000,25000,25000,25000,25000,25000,25000,25000] },
  { category:"Gastos Generales", item:"Aseo", amounts:[330439,200000,200000,200000,200000,200000,200000,200000,200000,200000,200000,200000] },
  { category:"Compromisos ACYM", item:"Retiro Distrital", amounts:[0,0,0,0,50000,0,0,0,0,0,null,0] },
  { category:"Compromisos ACYM", item:"Convención Distrital", amounts:[null,null,null,null,null,null,null,null,null,null,300000,null] },
  { category:"Compromisos ACYM", item:"Sínodo Pastoral", amounts:[null,null,null,null,null,200000,null,null,null,null,null,null] },
  { category:"Compromisos ACYM", item:"Junta General", amounts:[400000,0,0,0,0,0,0,0,0,0,0,0] },
  { category:"Compromisos ACYM", item:"Aporte Misionero", amounts:[200000,200000,200000,200000,200000,200000,200000,200000,200000,200000,200000,200000] },
  { category:"Ministerios", item:"Ayuda social", amounts:[0,0,0,0,0,0,0,0,0,0,0,0] },
  { category:"Ministerios", item:"Aportes a ministerios", amounts:[50000,50000,50000,50000,50000,50000,50000,50000,50000,50000,50000,50000] }
];
export const amountForMonth = (item: BudgetItem, index: number) => item.amounts[index] ?? 0;
export const annualAmount = (item: BudgetItem) => item.amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
