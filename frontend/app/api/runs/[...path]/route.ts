import { proxyRecording } from "@/lib/server/run-proxy";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRecording(request, (await context.params).path);
}
export const GET = handle;
export const DELETE = handle;
