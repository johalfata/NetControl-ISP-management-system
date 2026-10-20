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
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Manajemen Tagihan (Invoices)</h2>
          <p className="text-sm text-slate-400 mt-1.5">Daftar tagihan bulanan dan manual seluruh pelanggan.</p>
        </div>
      </div>

      <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-950/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-5">Nomor Invoice</th>
                <th className="p-5">Pelanggan</th>
                <th className="p-5">Periode Layanan</th>
                <th className="p-5">Total Tagihan</th>
                <th className="p-5">Jatuh Tempo</th>
                <th className="p-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {result.data.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-5 font-mono text-teal-400 font-semibold">{inv.number}</td>
                  <td className="p-5 text-white font-bold tracking-tight">{inv.customerName ?? "-"}</td>
                  <td className="p-5 text-slate-300 text-xs font-mono">
                    {new Date(inv.periodStart).toLocaleDateString("id-ID")} &mdash; {new Date(inv.periodEnd).toLocaleDateString("id-ID")}
                  </td>
                  <td className="p-5 font-extrabold text-white font-mono">Rp {inv.totalMinor.toLocaleString("id-ID")}</td>
                  <td className="p-5 text-slate-300 text-xs font-mono">{new Date(inv.dueDate).toLocaleDateString("id-ID")}</td>
                  <td className="p-5">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
                        inv.status === "PAID"
                          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                          : inv.status === "ISSUED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500">
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
