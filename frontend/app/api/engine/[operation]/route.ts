import { NextResponse } from "next/server";
const operations = new Set(["run", "replay", "compare", "exports"]);
export async function POST(
  _request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!operations.has(operation))
    return NextResponse.json(
      { message: "Unknown engine operation." },
      { status: 404 },
    );
  // TODO: forward to the Python API. Replay verification, CSV validation and
  // fingerprinted exports must remain authoritative in Python.
  return NextResponse.json(
    {
      code: "ENGINE_NOT_CONNECTED",
      message:
        "Python engine API is not connected yet. This control is a placeholder.",
    },
    { status: 501 },
  );
}
