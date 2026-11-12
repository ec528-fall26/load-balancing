import { Suspense } from "react";
import SimulationWorkspace from "@/components/simulation-workspace";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-8">Loading simulation…</p>}>
      <SimulationWorkspace>{children}</SimulationWorkspace>
    </Suspense>
  );
}
