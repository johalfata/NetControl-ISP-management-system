export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { listCustomers } from "@/lib/services/customers";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const actor = await currentActor();
  const params = await searchParams;
  const result = await listCustomers(
    actor!,
    {
      search: params.search,
      status: params.status as "ACTIVE" | "SUSPENDED" | "ARCHIVED" | undefined,
    },
    { page: 1, pageSize: 100 }
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Manajemen Pelanggan</h2>
          <p className="text-sm text-slate-400 mt-1.5">Kelola seluruh data pelanggan, status layanan, dan profil PPPoE aktif.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/customers/new"
            className="flex items-center gap-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-slate-950 px-5 py-2.5 rounded-2xl font-semibold text-sm transition-all shadow-lg shadow-teal-500/20 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Tambah Pelanggan
          </Link>
        </div>
      </div>

      <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden">
        <div className="p-6 border-b border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-950/40">
          <form method="GET" className="flex items-center gap-3 w-full max-w-lg">
            <input
              type="text"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Cari nama, email, nomor HP, kode..."
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all font-medium"
            />
            <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-5 py-3 rounded-2xl text-sm font-semibold transition-colors shrink-0 active:scale-[0.98]">
              Cari
            </button>
          </form>
          <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
            Total: <span className="text-teal-400 font-bold">{result.total}</span> pelanggan
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-950/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-5">Kode / Nama Pelanggan</th>
                <th className="p-5">Kontak</th>
                <th className="p-5">Paket / Layanan</th>
                <th className="p-5">PPPoE User</th>
                <th className="p-5">Status</th>
                <th className="p-5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {result.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40 transition-colors group">
                  <td className="p-5">
                    <p className="font-bold text-white tracking-tight">{c.name}</p>
                    <p className="text-xs text-teal-400 font-mono mt-0.5">{c.code}</p>
                  </td>
                  <td className="p-5 text-slate-300">
                    <p className="font-medium">{c.phone ?? "-"}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{c.email ?? "-"}</p>
                  </td>
                  <td className="p-5 text-slate-300">
                    <p className="font-medium">{c.planName ?? "-"}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Tagihan tgl {c.billingDay ?? 1}</p>
                  </td>
                  <td className="p-5 font-mono text-xs text-teal-300">{c.pppoeUsername ?? "-"}</td>
                  <td className="p-5">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
                        c.status === "ACTIVE"
                          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                          : c.status === "SUSPENDED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="p-5 text-right">
                    <Link
                      href={`/customers/${c.id}`}
                      className="inline-flex items-center justify-center text-teal-400 hover:text-teal-300 font-semibold text-xs bg-teal-500/10 border border-teal-500/20 px-3.5 py-2 rounded-xl transition-all active:scale-95 shadow-sm hover:bg-teal-500/20"
                    >
                      Detail &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500">
                    Tidak ada pelanggan ditemukan.
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
