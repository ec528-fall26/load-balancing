import { proxyPython } from "@/lib/server/engine-proxy";
export async function POST(request: Request) {
  return proxyPython(request, "research/cpu-io");
}
