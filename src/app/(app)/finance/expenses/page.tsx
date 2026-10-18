export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { listExpenses } from "@/lib/services/finance";

export default async function ExpensesPage() {
  const actor = await currentActor();
  const result = await listExpenses(actor!, {}, { page: 1, pageSize: 100 });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Keuangan & Biaya (Expenses)</h2>
          <p className="text-sm text-slate-400 mt-1">Pencatatan pengeluaran operasional dan vendor.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Kategori</th>
                <th className="p-4">Keterangan</th>
                <th className="p-4">Jumlah</th>
                <th className="p-4">Tanggal</th>
                <th className="p-4">Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {result.data.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-semibold text-teal-400">{e.categoryName}</td>
                  <td className="p-4 text-white">{e.description}</td>
                  <td className="p-4 font-bold text-red-400">Rp {e.amountMinor.toLocaleString("id-ID")}</td>
                  <td className="p-4 text-slate-300 text-xs">{new Date(e.date).toLocaleDateString("id-ID")}</td>
                  <td className="p-4 text-slate-400 text-xs">{e.vendor ?? "-"}</td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Tidak ada pengeluaran ditemukan.
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
