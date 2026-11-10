import { proxySession } from "@/lib/server/session-proxy";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) {
  return proxySession(request, (await context.params).path ?? []);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
