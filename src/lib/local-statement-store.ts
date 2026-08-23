import { promises as fs } from "fs";
import path from "path";
import type { ParsedStatement } from "./bank-statement-parser";

const directory = path.join(process.cwd(), "storage", "statements");
export type StoredStatement = ParsedStatement & { id: string; fileName: string; uploadedAt: string };

export async function saveStatement(statement: ParsedStatement, original: Buffer, fileName: string): Promise<StoredStatement> {
  await fs.mkdir(directory, { recursive: true });
  const metadataPath = path.join(directory, `${statement.sourceHash}.json`);
  try { await fs.access(metadataPath); throw new Error("DUPLICATE"); } catch (error) { if ((error as Error).message === "DUPLICATE") throw error; }
  const stored: StoredStatement = { ...statement, id: statement.sourceHash, fileName, uploadedAt: new Date().toISOString() };
  await fs.writeFile(path.join(directory, `${statement.sourceHash}.pdf`), original);
  await fs.writeFile(metadataPath, JSON.stringify(stored, null, 2), "utf8");
  return stored;
}

export async function listStatements(): Promise<StoredStatement[]> {
  try {
    const files = (await fs.readdir(directory)).filter(name => name.endsWith(".json"));
    return await Promise.all(files.map(async name => JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as StoredStatement));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
