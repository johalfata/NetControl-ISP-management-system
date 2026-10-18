export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export default async function NotificationsPage() {
  const messages = await prisma.notificationMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Notifikasi WhatsApp</h2>
        <p className="text-sm text-slate-400 mt-1">Riwayat pengiriman pesan WhatsApp (Fonnte) ke pelanggan.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Tujuan / Telepon</th>
                <th className="p-4">Pesan</th>
                <th className="p-4">Channel</th>
                <th className="p-4">Status</th>
                <th className="p-4">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {messages.map((m) => (
                <tr key={m.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-mono text-teal-300">{m.toAddress}</td>
                  <td className="p-4 text-slate-300 max-w-md truncate">{m.body}</td>
                  <td className="p-4 text-slate-400">{m.channel}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {m.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-xs">{new Date(m.createdAt).toLocaleString("id-ID")}</td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Tidak ada riwayat notifikasi.
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
