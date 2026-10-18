export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { listPayments } from "@/lib/services/payments";

export default async function PaymentsPage() {
  const actor = await currentActor();
  const result = await listPayments(actor!, {}, { page: 1, pageSize: 100 });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Pembayaran (Payments)</h2>
          <p className="text-sm text-slate-400 mt-1">Riwayat pembayaran dan alokasi dana.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Nomor Pembayaran</th>
                <th className="p-4">Pelanggan</th>
                <th className="p-4">Metode</th>
                <th className="p-4">Jumlah</th>
                <th className="p-4">Tanggal</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {result.data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-mono text-teal-400 font-medium">{p.number}</td>
                  <td className="p-4 text-white font-medium">{p.customerName ?? "-"}</td>
                  <td className="p-4 text-slate-300">{p.methodName ?? "-"}</td>
                  <td className="p-4 font-bold text-teal-400">Rp {p.amountMinor.toLocaleString("id-ID")}</td>
                  <td className="p-4 text-slate-300 text-xs">{new Date(p.paidAt).toLocaleDateString("id-ID")}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Tidak ada pembayaran ditemukan.
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
