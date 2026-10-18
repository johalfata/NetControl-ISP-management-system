import { currentPortalActor } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

export const metadata = {
  title: "Portal Pelanggan - NetControl",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const portalActor = await currentPortalActor();
  if (!portalActor) {
    redirect("/portal/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center font-bold text-white text-sm">
            CP
          </div>
          <span className="font-bold text-teal-400">Portal Pelanggan NetControl</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-300">{portalActor.label}</span>
          <form action="/api/auth/portal/logout" method="POST">
            <button
              type="submit"
              className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-8">{children}</main>
    </div>
  );
}
