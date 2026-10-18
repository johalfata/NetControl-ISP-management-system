export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { CreditCard } from "lucide-react";

export default async function SubscriptionsPage() {
  const _actor = await currentActor();
  const subscriptions = await prisma.subscription.findMany({
    include: {
      customer: true,
      plan: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <CreditCard className="w-7 h-7 text-teal-400" />
            Manajemen Langganan (Subscriptions)
          </h2>
          <p className="text-sm text-slate-400 mt-1">Daftar langganan paket internet aktif dan riwayat pelanggan.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Pelanggan</th>
                <th className="p-4">Paket Layanan</th>
                <th className="p-4">Harga / Bulan</th>
                <th className="p-4">Kecepatan (Down/Up)</th>
                <th className="p-4">Status</th>
                <th className="p-4">Mulai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4">
                    <p className="font-semibold text-white">{sub.customer.name}</p>
                    <p className="text-xs text-teal-400 font-mono">{sub.customer.code}</p>
                  </td>
                  <td className="p-4 font-medium text-slate-200">{sub.plan.name}</td>
                  <td className="p-4 font-semibold text-teal-400">Rp {Number(sub.priceMinor).toLocaleString("id-ID")}</td>
                  <td className="p-4 font-mono text-xs text-slate-300">
                    {sub.downloadKbps / 1000} Mbps / {sub.uploadKbps / 1000} Mbps
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        sub.status === "ACTIVE"
                          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                          : sub.status === "CANCELLED"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-xs">{new Date(sub.startedAt).toLocaleDateString("id-ID")}</td>
                </tr>
              ))}
              {subscriptions.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Tidak ada data langganan ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
