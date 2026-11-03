import { proxyPython } from "./engine-proxy";
export function proxyRecording(
  request: Request,
  parts: string[],
  options: Parameters<typeof proxyPython>[2] = {},
): Promise<Response> {
  const id = /^[a-f0-9]{32}$/,
    method = request.method,
    query = new URL(request.url).searchParams;
  const valid =
    (parts.length === 1 &&
      id.test(parts[0]) &&
      ["GET", "DELETE"].includes(method)) ||
    (parts.length === 2 &&
      id.test(parts[0]) &&
      ["events", "snapshot"].includes(parts[1]) &&
      method === "GET");
  const allowed = new Set(
    parts[1] === "events"
      ? ["offset", "limit"]
      : parts[1] === "snapshot"
        ? ["time", "server_offset", "server_limit"]
        : [],
  );
  if (
    !valid ||
    [...query].some(
      ([k, v]) =>
        !allowed.has(k) ||
        query.getAll(k).length !== 1 ||
        !(k === "time"
          ? v.length <= 32 &&
            /^\d+(\.\d+)?([eE][+-]?\d{1,3})?$/.test(v) &&
            Number.isFinite(Number(v))
          : /^\d{1,6}$/.test(v)),
    )
  )
    return Promise.resolve(
      Response.json(
        {
          api_version: "1",
          code: "INVALID_REQUEST",
          message: "Unknown recorded-run operation or invalid query.",
          field_errors: [],
        },
        { status: 422 },
      ),
    );
  return proxyPython(
    request,
    "runs/" + parts.join("/") + (query.size ? "?" + query : ""),
    options,
  );
}
