export const dynamic = "force-dynamic";
import { currentPortalActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getCustomer } from "@/lib/services/customers";

export default async function PortalDashboardPage() {
  const portalActor = await currentPortalActor();
  const customer = await getCustomer(
    { kind: "user", userId: portalActor!.portalUserId, role: "READONLY", label: portalActor!.label },
    portalActor!.customerId
  );

  const [invoices, _payments, _tickets] = await Promise.all([
    prisma.invoice.findMany({ where: { customerId: customer.id }, orderBy: { issueDate: "desc" }, take: 10 }),
    prisma.payment.findMany({ where: { customerId: customer.id }, orderBy: { paidAt: "desc" }, take: 10 }),
    prisma.ticket.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Selamat Datang, {customer.name}</h2>
        <p className="text-sm text-slate-400 mt-1">Kode Pelanggan: {customer.code} | Status: {customer.status}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Paket Langganan</h3>
          {customer.activeSubscription ? (
            <div className="space-y-2 text-sm">
              <p className="text-white font-bold text-lg">{customer.activeSubscription.planName}</p>
              <p className="text-teal-400 font-semibold">Rp {customer.activeSubscription.priceMinor.toLocaleString("id-ID")} / bulan</p>
              <p className="text-xs text-slate-400">Kecepatan: {customer.activeSubscription.downloadKbps} Mbps / {customer.activeSubscription.uploadKbps} Mbps</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Tidak ada paket aktif.</p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Informasi Kontak & PPPoE</h3>
          <div className="text-sm space-y-2">
            <p className="text-slate-300"><span className="text-slate-500">Telepon:</span> {customer.phone ?? "-"}</p>
            <p className="text-slate-300"><span className="text-slate-500">Email:</span> {customer.email ?? "-"}</p>
            <p className="text-slate-300"><span className="text-slate-500">Username PPPoE:</span> <span className="font-mono text-teal-300">{customer.pppoeUsername ?? "-"}</span></p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Tagihan Terbaru</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3">Nomor</th>
                <th className="py-3">Total</th>
                <th className="py-3">Jatuh Tempo</th>
                <th className="py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-3 font-mono text-teal-400">{inv.number}</td>
                  <td className="py-3 font-semibold text-white">Rp {Number(inv.totalMinor).toLocaleString("id-ID")}</td>
                  <td className="py-3 text-slate-300 text-xs">{new Date(inv.dueDate).toLocaleDateString("id-ID")}</td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">Tidak ada tagihan.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
