import { proxyPython } from "@/lib/server/engine-proxy";
export function POST(request: Request) {
  return proxyPython(request, "regions/run");
}
