import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bruma | Gestión para comercios",
  description: "Panel de gestión de ventas e inventario.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
