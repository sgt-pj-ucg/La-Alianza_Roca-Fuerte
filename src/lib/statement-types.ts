import type { ExtractedTransaction, ParsedStatement } from "./bank-statement-parser";

export type StoredStatement = ParsedStatement & {
  id: string;
  fileName: string;
  uploadedAt: string;
  sourcePath: string;
};

export type StoredTransaction = ExtractedTransaction;
