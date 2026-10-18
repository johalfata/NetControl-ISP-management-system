export const dynamic = "force-dynamic";
import { listTickets } from "@/lib/services/tickets";

export default async function HelpdeskPage() {
  const tickets = await listTickets();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Helpdesk & Tiket Bantuan</h2>
        <p className="text-sm text-slate-400 mt-1">Daftar laporan gangguan dan tiket dukungan pelanggan.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Subjek</th>
                <th className="p-4">Pelanggan</th>
                <th className="p-4">Prioritas</th>
                <th className="p-4">Status</th>
                <th className="p-4">Dibuat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-semibold text-white">{t.subject}</td>
                  <td className="p-4 text-slate-300">{t.customerName ?? "-"}</td>
                  <td className="p-4 text-amber-400 font-medium">{t.priority}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {t.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-xs">{new Date(t.createdAt).toLocaleDateString("id-ID")}</td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Tidak ada tiket bantuan ditemukan.
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
