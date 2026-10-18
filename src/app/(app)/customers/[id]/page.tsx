export const dynamic = "force-dynamic";
import { currentActor } from "@/lib/auth/guard";
import { getCustomer } from "@/lib/services/customers";
import Link from "next/link";
import { ArrowLeft, Phone, Mail, MapPin } from "lucide-react";

type RouteParams = { params: Promise<{ id: string }> };

export default async function CustomerDetailPage({ params }: RouteParams) {
  const actor = await currentActor();
  const { id } = await params;
  const customer = await getCustomer(actor!, id);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/customers" className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">{customer.name}</h2>
          <p className="text-xs text-teal-400 font-mono mt-0.5">Kode: {customer.code}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Informasi Pelanggan</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Kontak</p>
              <p className="text-white font-medium mt-1 flex items-center gap-2"><Phone className="w-4 h-4 text-teal-400" /> {customer.phone ?? "-"}</p>
              <p className="text-slate-300 mt-1 flex items-center gap-2"><Mail className="w-4 h-4 text-teal-400" /> {customer.email ?? "-"}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Alamat & Lokasi</p>
              <p className="text-white mt-1 flex items-start gap-2"><MapPin className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" /> {customer.address ?? "-"}</p>
              <p className="text-xs text-slate-400 mt-1">{customer.city}, {customer.district}</p>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <h4 className="text-sm font-bold text-white mb-3">Layanan PPPoE & Router</h4>
            <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div>
                <p className="text-xs text-slate-400">Username PPPoE</p>
                <p className="font-mono text-teal-300 font-medium mt-1">{customer.pppoeUsername ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Router Terhubung</p>
                <p className="text-white font-medium mt-1">{customer.routerName ?? "-"}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Paket Langganan</h3>
          {customer.activeSubscription ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-slate-400">Nama Paket</p>
                <p className="text-white font-bold text-lg mt-1">{customer.activeSubscription.planName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Harga / Bulan</p>
                <p className="text-teal-400 font-bold mt-1">Rp {customer.activeSubscription.priceMinor.toLocaleString("id-ID")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <p className="text-xs text-slate-500">Download</p>
                  <p className="text-xs font-mono text-slate-200">{customer.activeSubscription.downloadKbps} Kbps</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Upload</p>
                  <p className="text-xs font-mono text-slate-200">{customer.activeSubscription.uploadKbps} Kbps</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Tidak ada paket aktif.</p>
          )}

          <div className="border-t border-slate-800 pt-6">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Status Akun</p>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium mt-2 ${
                customer.status === "ACTIVE"
                  ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}
            >
              {customer.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
