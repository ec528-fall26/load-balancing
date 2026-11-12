import { proxyPython } from "@/lib/server/engine-proxy";
export function GET(request: Request) {
  return proxyPython(request, "regions/presets");
}
