/**
 * Obtiene el nombre que el banco incluye en transferencias entrantes.
 * No intenta adivinar nombres desde depósitos en efectivo u otros textos:
 * en esos casos la tesorera debe identificar el aporte manualmente.
 */
export function extractContributorFromBankText(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Ejemplo de cartola: "Traspaso De: Jorge Alejandro Cortes Veliz".
  const match = text.match(/\b(?:traspaso|transferencia)\s+de\s*:\s*(.+)$/i);
  if (!match) return null;

  const name = match[1].trim();
  return name.length >= 2 ? name : null;
}

/**
 * El nombre editado por tesorería tiene siempre prioridad. Solo cuando no
 * existe, se usa el nombre trazable que vino en la descripción bancaria.
 */
export function resolveContributorName(displayName: unknown, bankDescription: unknown): string | null {
  const editedName = String(displayName ?? "").replace(/\s+/g, " ").trim();
  return editedName || extractContributorFromBankText(bankDescription);
}
