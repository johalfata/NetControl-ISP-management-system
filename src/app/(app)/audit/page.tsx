export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Audit Logs</h2>
        <p className="text-sm text-slate-400 mt-1">Catatan aktivitas dan perubahan sistem oleh pengguna.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Aktor</th>
                <th className="p-4">Aksi</th>
                <th className="p-4">Entitas</th>
                <th className="p-4">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 text-white font-medium">{log.actorLabel}</td>
                  <td className="p-4 font-mono text-teal-300">{log.action}</td>
                  <td className="p-4 text-slate-300 font-mono text-xs">{log.entityType}: {log.entityId}</td>
                  <td className="p-4 text-slate-400 text-xs">{new Date(log.createdAt).toLocaleString("id-ID")}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    Tidak ada log audit.
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
