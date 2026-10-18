import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  FileText,
  DollarSign,
  Router,
  Network,
  Activity,
  LifeBuoy,
  Bell,
  Settings,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { currentActor } from "@/lib/auth/guard";
import { redirect } from "next/navigation";



export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) {
    redirect("/login");
  }

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/customers", label: "Pelanggan", icon: Users },
    { href: "/subscriptions", label: "Langganan", icon: CreditCard },
    { href: "/billing/invoices", label: "Tagihan", icon: FileText },
    { href: "/billing/payments", label: "Pembayaran", icon: CreditCard },
    { href: "/finance/expenses", label: "Keuangan & Biaya", icon: DollarSign },
    { href: "/routers", label: "Router / MikroTik", icon: Router },
    { href: "/network/wan", label: "WAN & Bandwidth", icon: Network },
    { href: "/network/olt", label: "FTTH / OLT Topologi", icon: Activity },
    { href: "/helpdesk", label: "Helpdesk", icon: LifeBuoy },
    { href: "/notifications", label: "Notifikasi", icon: Bell },
    { href: "/settings", label: "Pengaturan", icon: Settings },
    { href: "/audit", label: "Audit Log", icon: ShieldAlert },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-600 flex items-center justify-center font-bold text-white shadow-lg shadow-teal-900/50">
            NC
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-teal-400">NetControl</h1>
            <p className="text-xs text-slate-400">ISP Management</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-teal-400 transition-colors"
              >
                <Icon className="w-4 h-4 text-teal-500" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between">
          <div className="truncate">
            <p className="text-sm font-medium text-slate-200 truncate">{actor.label}</p>
            <p className="text-xs text-teal-400 font-mono">{actor.role}</p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-slate-950">
        <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-900/50 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
              Sistem Aktif
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          </div>
        </header>

        <div className="p-8 flex-1 max-w-7xl w-full mx-auto">{children}</div>
      </main>
    </div>
  );
}
