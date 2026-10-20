export const dynamic = "force-dynamic";
import Link from "next/link";
import { currentActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getFinancialSummary } from "@/lib/services/finance";
import { Users, FileText, CreditCard, Router as RouterIcon, TrendingUp } from "lucide-react";

export default async function DashboardPage() {
  const actor = await currentActor();
  const [customerCount, activeSubCount, invoiceCount, routerCount, financialSummary] = await Promise.all([
    prisma.customer.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.invoice.count({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } } }),
    prisma.router.count(),
    getFinancialSummary(actor!),
  ]);

  const stats = [
    { label: "Pelanggan Aktif", value: customerCount, icon: Users, color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20" },
    { label: "Langganan Aktif", value: activeSubCount, icon: CreditCard, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
    { label: "Tagihan Belum Lunas", value: invoiceCount, icon: FileText, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    { label: "Router Terdaftar", value: routerCount, icon: RouterIcon, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
  ];

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Dashboard Operasional</h2>
          <p className="text-sm text-slate-400 mt-1.5">Ringkasan performa jaringan, pelanggan, dan keuangan ISP NetControl secara real-time.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/customers/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-slate-950 shadow-lg shadow-teal-500/20 transition-all active:scale-[0.98]"
          >
            <Users className="w-4 h-4" />
            Tambah Pelanggan
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-7 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center justify-between group hover:border-slate-700/80 transition-all"
            >
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                <p className="text-4xl font-extrabold text-white mt-2 font-mono tracking-tight">{stat.value.toLocaleString("id-ID")}</p>
              </div>
              <div className={`w-14 h-14 rounded-2xl ${stat.bg} ${stat.color} border ${stat.border} flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform`}>
                <Icon className="w-7 h-7" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">Ringkasan Keuangan Periode Ini</h3>
              <p className="text-xs text-slate-400 mt-1">Akumulasi pendapatan, biaya operasional, dan laba bersih</p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-800/80">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Pendapatan</p>
              <p className="text-2xl font-extrabold text-teal-400 mt-2 font-mono tracking-tight">Rp {financialSummary.revenueMinor.toLocaleString("id-ID")}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Pengeluaran</p>
              <p className="text-2xl font-extrabold text-rose-400 mt-2 font-mono tracking-tight">Rp {financialSummary.expensesMinor.toLocaleString("id-ID")}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hasil Operasional</p>
              <p className="text-2xl font-extrabold text-white mt-2 font-mono tracking-tight">Rp {financialSummary.operatingResultMinor.toLocaleString("id-ID")}</p>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex flex-col justify-between">
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight mb-2">Pintasan Cepat</h3>
            <p className="text-xs text-slate-400 mb-6">Akses cepat tugas operasional harian</p>
            <div className="space-y-3">
              <Link href="/customers" className="flex items-center justify-between w-full bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 font-semibold px-4 py-3.5 rounded-2xl transition-all text-sm group active:scale-[0.98]">
                <span>Kelola Pelanggan</span>
                <span className="text-teal-400 group-hover:translate-x-1 transition-transform">&rarr;</span>
              </Link>
              <Link href="/billing/invoices" className="flex items-center justify-between w-full bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 font-semibold px-4 py-3.5 rounded-2xl transition-all text-sm group active:scale-[0.98]">
                <span>Kelola Tagihan & Pembayaran</span>
                <span className="text-teal-400 group-hover:translate-x-1 transition-transform">&rarr;</span>
              </Link>
              <Link href="/routers" className="flex items-center justify-between w-full bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 font-semibold px-4 py-3.5 rounded-2xl transition-all text-sm group active:scale-[0.98]">
                <span>Monitoring Router MikroTik</span>
                <span className="text-teal-400 group-hover:translate-x-1 transition-transform">&rarr;</span>
              </Link>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-slate-800/80 text-xs text-slate-400 flex items-center justify-between font-mono">
            <span>NetControl Core</span>
            <span className="text-teal-400 font-semibold">Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
