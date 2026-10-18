"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type RouterItem = {
  id: string;
  code: string;
  name: string;
  host: string;
  apiPort: number;
  isMonitoringEnabled: boolean;
  updatedAt: string;
};

export default function RoutersPage() {
  const router = useRouter();
  const [routers, setRouters] = useState<RouterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    host: "",
    apiPort: 8728,
    username: "admin",
    password: "",
    notes: "",
  });

  const fetchRouters = async () => {
    try {
      const res = await fetch("/api/routers");
      const data = await res.json();
      if (res.ok) {
        setRouters(data.routers || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRouters();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menambahkan router");
      }
      setShowModal(false);
      setForm({
        code: "",
        name: "",
        host: "",
        apiPort: 8728,
        username: "admin",
        password: "",
        notes: "",
      });
      fetchRouters();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Router & MikroTik</h2>
          <p className="text-sm text-slate-400 mt-1">Manajemen perangkat router dan monitoring jaringan.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 transition-all cursor-pointer"
        >
          + Tambah Router
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="p-4">Kode</th>
                <th className="p-4">Nama Router</th>
                <th className="p-4">Host / IP</th>
                <th className="p-4">Port API</th>
                <th className="p-4">Status Monitor</th>
                <th className="p-4">Terakhir Diperbarui</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Memuat data...
                  </td>
                </tr>
              ) : (
                routers.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="p-4 font-mono text-teal-400">{r.code}</td>
                    <td className="p-4 font-semibold text-white">{r.name}</td>
                    <td className="p-4 font-mono text-slate-200">{r.host}</td>
                    <td className="p-4 font-mono text-slate-300">{r.apiPort}</td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          r.isMonitoringEnabled
                            ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {r.isMonitoringEnabled ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="p-4 text-slate-400 text-xs">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleString("id-ID") : "-"}
                    </td>
                  </tr>
                ))
              )}
              {!loading && routers.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Tidak ada router terdaftar. Klik tombol &quot;+ Tambah Router&quot; di atas untuk mendaftarkan router MikroTik.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Tambah Router */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white">Tambah Router MikroTik</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Kode Router</label>
                  <input
                    type="text"
                    required
                    placeholder="mis. RB-CORE-01"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Nama Router</label>
                  <input
                    type="text"
                    required
                    placeholder="mis. Router Utama"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Host / IP Address</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.1"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Port API</label>
                  <input
                    type="number"
                    required
                    value={form.apiPort}
                    onChange={(e) => setForm({ ...form, apiPort: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Username API</label>
                  <input
                    type="text"
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Password API</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Catatan (Opsional)</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
                />
              </div>
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Menyimpan..." : "Simpan Router"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
