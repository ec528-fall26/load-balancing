import { cpuIOPolicies } from "./policy-metadata";
// Research templates use the CPU/I/O model, not the single-stage saved-run schema.
export type CPUIOTemplate = {
  id: string;
  name: string;
  description: string;
  mode: "walkthrough" | "workload";
  profile: "cpu_heavy" | "io_heavy";
  rate: number;
  policy: keyof typeof cpuIOPolicies;
};
export const cpuIOTemplates: CPUIOTemplate[] = [
  {
    id: "cpu-io-walkthrough",
    name: "CPU to I/O, step by step",
    description: "Two requests share one CPU. Watch I/O release CPU while both admission places remain occupied.",
    mode: "walkthrough", profile: "io_heavy", rate: 100, policy: "round_robin",
  },
  {
    id: "io-heavy-routing",
    name: "I/O-heavy routing",
    description: "Compare three policies when requests spend 90% of their service time waiting on I/O.",
    mode: "workload", profile: "io_heavy", rate: 400, policy: "power_of_two",
  },
  {
    id: "cpu-heavy-routing",
    name: "CPU-heavy routing",
    description: "Put CPU capacity under pressure and compare rejection and tail latency on identical requests.",
    mode: "workload", profile: "cpu_heavy", rate: 100, policy: "round_robin",
  },
];
export function cpuIOTemplateHref(template: CPUIOTemplate) {
  return `/cpu-io?template=${encodeURIComponent(template.id)}`;
}
