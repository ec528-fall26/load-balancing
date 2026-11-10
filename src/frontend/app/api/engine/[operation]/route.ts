import { NextResponse } from "next/server";
import { proxyPython } from "@/lib/server/engine-proxy";
const operations = new Set(["run", "replay", "compare", "exports"]);
export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!operations.has(operation))
    return NextResponse.json(
      { message: "Unknown engine operation." },
      { status: 404 },
    );
  if (operation === "run") return proxyPython(request, "runs");
  // Saved-run workflows are connected separately in A-07.
  return NextResponse.json(
    {
      code: "ENGINE_NOT_CONNECTED",
      message:
        "Python engine API is not connected yet. This control is a placeholder.",
    },
    { status: 501 },
  );
}
