export const dynamic = "force-dynamic";
import { getAllSettings } from "@/lib/settings/service";
import { Settings } from "lucide-react";

export default async function SettingsPage() {
  const settings = await getAllSettings();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Pengaturan Sistem</h2>
        <p className="text-sm text-slate-400 mt-1">Konfigurasi perusahaan, penomoran invoice, dan parameter penagihan.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
          <Settings className="w-5 h-5 text-teal-400" /> Profil Perusahaan & Operasional
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Nama Perusahaan</p>
            <p className="text-white font-medium mt-1 bg-slate-950 p-3 rounded-xl border border-slate-800">{String(settings.companyName ?? "-")}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Email Perusahaan</p>
            <p className="text-white font-medium mt-1 bg-slate-950 p-3 rounded-xl border border-slate-800">{String(settings.companyEmail ?? "-")}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Telepon / WhatsApp</p>
            <p className="text-white font-medium mt-1 bg-slate-950 p-3 rounded-xl border border-slate-800">{String(settings.companyPhone ?? "-")}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Mata Uang & Timezone</p>
            <p className="text-white font-medium mt-1 bg-slate-950 p-3 rounded-xl border border-slate-800">{String(settings.currency)} ({String(settings.timezone)})</p>
          </div>
        </div>
      </div>
    </div>
  );
}
