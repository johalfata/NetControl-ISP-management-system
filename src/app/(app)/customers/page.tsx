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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Pelanggan</h2>
          <p className="text-sm text-slate-400 mt-1">Kelola data pelanggan dan layanan internet.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/customers/new"
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-lg shadow-teal-950"
          >
            <Plus className="w-4 h-4" />
            Tambah Pelanggan
          </Link>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <form method="GET" className="flex items-center gap-3 w-full max-w-md">
            <input
              type="text"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Cari nama, email, nomor HP, kode..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-500"
            />
            <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              Cari
            </button>
          </form>
          <span className="text-xs text-slate-400">Total: {result.total} pelanggan</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Kode / Nama</th>
                <th className="p-4">Kontak</th>
                <th className="p-4">Paket / Layanan</th>
                <th className="p-4">PPPoE User</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {result.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4">
                    <p className="font-semibold text-white">{c.name}</p>
                    <p className="text-xs text-teal-400 font-mono">{c.code}</p>
                  </td>
                  <td className="p-4 text-slate-300">
                    <p>{c.phone ?? "-"}</p>
                    <p className="text-xs text-slate-500">{c.email ?? "-"}</p>
                  </td>
                  <td className="p-4 text-slate-300">
                    <p>{c.planName ?? "-"}</p>
                    <p className="text-xs text-slate-500">Tagihan tgl {c.billingDay ?? 1}</p>
                  </td>
                  <td className="p-4 font-mono text-xs text-teal-300">{c.pppoeUsername ?? "-"}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        c.status === "ACTIVE"
                          ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                          : c.status === "SUSPENDED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <Link
                      href={`/customers/${c.id}`}
                      className="text-teal-400 hover:text-teal-300 font-medium text-xs bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
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
