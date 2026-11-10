import { proxyPython } from "@/lib/server/engine-proxy";

const operations = new Map([
  ["run", "runs"],
  ["summarize", "run-summary"],
  ["replay", "saved/replay"],
  ["compare", "saved/compare"],
  ["exports", "saved/exports"],
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const path = operations.get(operation);
  if (!path) {
    return Response.json({ message: "Unknown engine operation." }, { status: 404 });
  }
  return proxyPython(request, path);
}
