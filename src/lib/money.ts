/** CLP is deliberately represented as an integer everywhere. */
export const clp = (amount: number) => new Intl.NumberFormat("es-CL", {
  style: "currency", currency: "CLP", maximumFractionDigits: 0
}).format(amount);

export const sumClp = (amounts: readonly number[]) => amounts.reduce((total, value) => total + value, 0);
