export const dynamic = "force-dynamic";
import { listInfraNodes } from "@/lib/services/infra";

export default async function OltPage() {
  const nodes = await listInfraNodes();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">FTTH / OLT & Topologi</h2>
        <p className="text-sm text-slate-400 mt-1">Manajemen perangkat OLT, ODC, ODP dan topologi jaringan.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Nama Node</th>
                <th className="p-4">Tipe</th>
                <th className="p-4">Status Perangkat</th>
                <th className="p-4">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {nodes.map((node) => (
                <tr key={node.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-semibold text-white">{node.name}</td>
                  <td className="p-4 text-teal-300">{node.type}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {node.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-300 font-mono text-xs">{node.ipAddress ?? "-"}</td>
                </tr>
              ))}
              {nodes.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    Tidak ada node infrastruktur terdaftar.
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
