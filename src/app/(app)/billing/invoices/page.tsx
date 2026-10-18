export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { listInvoices } from "@/lib/services/billing";

export default async function InvoicesPage() {
  const _actor = await currentActor();
  const result = await listInvoices({}, { page: 1, pageSize: 100 });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Tagihan (Invoices)</h2>
          <p className="text-sm text-slate-400 mt-1">Daftar tagihan bulanan dan manual pelanggan.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Nomor Invoice</th>
                <th className="p-4">Pelanggan</th>
                <th className="p-4">Periode</th>
                <th className="p-4">Total</th>
                <th className="p-4">Jatuh Tempo</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {result.data.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-mono text-teal-400 font-medium">{inv.number}</td>
                  <td className="p-4 text-white font-medium">{inv.customerName ?? "-"}</td>
                  <td className="p-4 text-slate-300 text-xs">
                    {new Date(inv.periodStart).toLocaleDateString("id-ID")} - {new Date(inv.periodEnd).toLocaleDateString("id-ID")}
                  </td>
                  <td className="p-4 font-semibold text-white">Rp {inv.totalMinor.toLocaleString("id-ID")}</td>
                  <td className="p-4 text-slate-300 text-xs">{new Date(inv.dueDate).toLocaleDateString("id-ID")}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        inv.status === "PAID"
                          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                          : inv.status === "ISSUED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Tidak ada tagihan ditemukan.
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
