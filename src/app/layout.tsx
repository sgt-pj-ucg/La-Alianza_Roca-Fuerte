import type { Metadata } from "next";
import "./globals.css";
import "./cartolas.css";
import "./clasificacion.css";

export const metadata: Metadata = {
  title: "Tesorería 2026",
  description: "Gestión presupuestaria de la iglesia"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
