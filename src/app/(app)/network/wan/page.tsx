export const dynamic = "force-dynamic";
import { listWanLinks } from "@/lib/services/wan";

export default async function WanPage() {
  const links = await listWanLinks();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">WAN & Bandwidth</h2>
        <p className="text-sm text-slate-400 mt-1">Monitoring koneksi uplink Starlink dan Dedicated.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Nama Link</th>
                <th className="p-4">Tipe</th>
                <th className="p-4">Provider</th>
                <th className="p-4">Kapasitas (Down/Up)</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {links.map((link) => (
                <tr key={link.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4 font-semibold text-white">{link.name}</td>
                  <td className="p-4 text-teal-300">{link.type}</td>
                  <td className="p-4 text-slate-300">{link.provider ?? "-"}</td>
                  <td className="p-4 font-mono text-slate-200">
                    {link.capacityDownKbps ? `${link.capacityDownKbps / 1000} Mbps` : "-"} / {link.capacityUpKbps ? `${link.capacityUpKbps / 1000} Mbps` : "-"}
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {link.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Tidak ada link WAN terdaftar.
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
