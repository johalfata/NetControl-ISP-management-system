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
    <div className="min-h-[100dvh] bg-[#09090b] text-slate-100 flex selection:bg-teal-500 selection:text-white">
      {/* Sidebar */}
      <aside className="w-72 bg-slate-900/60 backdrop-blur-xl border-r border-slate-800/80 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/80 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center font-bold text-slate-950 shadow-lg shadow-teal-500/20 ring-1 ring-white/20">
            NC
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight text-white flex items-center gap-2">
              NetControl <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">v1.0</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">ISP Management Core</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800/60 hover:text-white transition-all group active:scale-[0.98]"
              >
                <div className="p-2 rounded-lg bg-slate-800/80 text-teal-400 group-hover:bg-teal-500/10 group-hover:text-teal-300 transition-colors shadow-sm">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
          <div className="truncate pr-2">
            <p className="text-sm font-semibold text-white truncate tracking-tight">{actor.label}</p>
            <p className="text-xs text-teal-400 font-mono mt-0.5 uppercase tracking-wider">{actor.role}</p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="p-2.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer active:scale-95"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-[#09090b]">
        <header className="h-18 border-b border-slate-800/80 px-8 flex items-center justify-between bg-[#09090b]/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 text-xs font-semibold tracking-wide">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"></span>
              Sistem Aktif & Terhubung
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-400">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-mono">
              {new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
        </header>

        <div className="p-8 lg:p-10 flex-1 max-w-[1400px] w-full mx-auto space-y-8">{children}</div>
      </main>
    </div>
  );
}
