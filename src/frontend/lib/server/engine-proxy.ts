const MAX_BODY_BYTES = 65_536;
const SAVED_COMPARISON_BODY_BYTES = 12 * 1024 * 1024;

function failure(status: number, code: string, message: string) {
  return Response.json(
    { api_version: "1", code, message, field_errors: [] },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function proxyPython(
  request: Request,
  path: string,
  options: {
    backendUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const base =
    options.backendUrl ?? process.env.LBSIM_API_URL ?? "http://127.0.0.1:8000";
  let endpoint: URL;
  try {
    endpoint = new URL(`${base.replace(/\/+$/, "")}/v1/${path}`);
    if (!["http:", "https:"].includes(endpoint.protocol))
      throw new Error("Invalid protocol");
  } catch {
    return failure(
      503,
      "BACKEND_CONFIG",
      "The Python API address is not configured correctly.",
    );
  }

  const maximum = path === "saved/compare" ? SAVED_COMPARISON_BODY_BYTES : MAX_BODY_BYTES;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          return failure(
            413,
            "BODY_TOO_LARGE",
            `Request body exceeds ${maximum} bytes.`,
          );
        }
        chunks.push(value);
      }
  } catch {
    return failure(
      400,
      "INVALID_REQUEST",
      "The request body could not be read.",
    );
  } finally {
    reader?.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const deadline = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  try {
    const upstream = await (options.fetchImpl ?? fetch)(endpoint, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : body,
      cache: "no-store",
      signal: AbortSignal.any([request.signal, deadline]),
    });
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      await upstream.body?.cancel();
      return failure(
        502,
        "BACKEND_RESPONSE_INVALID",
        "The Python API returned an unexpected response.",
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (
      deadline.aborted ||
      (error instanceof Error && error.name === "TimeoutError")
    ) {
      return failure(
        504,
        "BACKEND_TIMEOUT",
        "The Python API took too long. Reduce the workload and retry.",
      );
    }
    return failure(
      503,
      "BACKEND_UNAVAILABLE",
      "Cannot reach the Python API. Start the backend and retry.",
    );
  }
}

export function proxyRun(
  request: Request,
  options: Parameters<typeof proxyPython>[2] = {},
) {
  return proxyPython(request, "run", options);
}
