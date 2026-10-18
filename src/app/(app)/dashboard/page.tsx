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
    { label: "Pelanggan Aktif", value: customerCount, icon: Users, color: "text-teal-400", bg: "bg-teal-500/10" },
    { label: "Langganan Aktif", value: activeSubCount, icon: CreditCard, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Tagihan Belum Lunas", value: invoiceCount, icon: FileText, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Router Terdaftar", value: routerCount, icon: RouterIcon, color: "text-purple-400", bg: "bg-purple-500/10" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Dashboard</h2>
        <p className="text-sm text-slate-400 mt-1">Ringkasan operasional dan keuangan ISP NetControl.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{stat.label}</p>
                <p className="text-3xl font-bold text-white mt-2">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-white">Ringkasan Keuangan</h3>
              <p className="text-xs text-slate-400">Pendapatan vs Pengeluaran periode ini</p>
            </div>
            <TrendingUp className="w-5 h-5 text-teal-400" />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800">
            <div>
              <p className="text-xs text-slate-400">Total Pendapatan</p>
              <p className="text-xl font-bold text-teal-400 mt-1">Rp {financialSummary.revenueMinor.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total Pengeluaran</p>
              <p className="text-xl font-bold text-red-400 mt-1">Rp {financialSummary.expensesMinor.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Hasil Operasional</p>
              <p className="text-xl font-bold text-white mt-1">Rp {financialSummary.operatingResultMinor.toLocaleString("id-ID")}</p>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-white mb-2">Pintasan Cepat</h3>
          <p className="text-xs text-slate-400 mb-6">Aksi operasional sehari-hari</p>
          <div className="space-y-3">
            <Link href="/customers" className="block w-full text-center bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2.5 rounded-xl transition-colors text-sm">
              Kelola Pelanggan
            </Link>
            <Link href="/billing/invoices" className="block w-full text-center bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2.5 rounded-xl transition-colors text-sm">
              Buat Tagihan Manual
            </Link>
            <Link href="/routers" className="block w-full text-center bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2.5 rounded-xl transition-colors text-sm">
              Monitoring Router
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
