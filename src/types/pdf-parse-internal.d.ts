declare module "pdf-parse/lib/pdf-parse" {
  export default function parsePdf(data: Buffer, options?: unknown): Promise<{ text: string }>;
}
