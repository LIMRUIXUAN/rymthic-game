import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RYTHMIC",
  description: "A rhythm roguelike where the enemy sets the tempo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
