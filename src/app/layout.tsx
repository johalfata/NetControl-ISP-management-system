
import "./globals.css";

export const metadata = {
  title: "NetControl",
  description: "Sistem manajemen ISP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
