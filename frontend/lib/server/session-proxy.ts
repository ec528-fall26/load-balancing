import { proxyPython } from "./engine-proxy";
export function proxySession(
  request: Request,
  parts: string[],
  options: Parameters<typeof proxyPython>[2] = {},
): Promise<Response> {
  const method = request.method,
    validId = /^[a-f0-9]{32}$/;
  const valid =
    (parts.length === 0 && method === "POST") ||
    (parts.length === 1 && validId.test(parts[0]) && method === "DELETE") ||
    (parts.length === 2 &&
      validId.test(parts[0]) &&
      ((parts[1] === "snapshot" && method === "GET") ||
        (parts[1] === "commands" && method === "POST")));
  if (!valid)
    return Promise.resolve(
      Response.json(
        {
          api_version: "1",
          code: "NOT_FOUND",
          message: "Unknown session operation.",
          field_errors: [],
        },
        { status: 404 },
      ),
    );
  const query = new URL(request.url).searchParams,
    allowed = new Set(["server_offset", "server_limit", "history_limit"]);
  if (
    [...query].some(
      ([key, value]) =>
        !allowed.has(key) ||
        query.getAll(key).length !== 1 ||
        !/^\d{1,4}$/.test(value),
    ) ||
    (query.size > 0 && parts[1] !== "snapshot")
  )
    return Promise.resolve(
      Response.json(
        {
          api_version: "1",
          code: "INVALID_REQUEST",
          message: "Invalid snapshot query.",
          field_errors: [],
        },
        { status: 422 },
      ),
    );
  return proxyPython(
    request,
    "sessions" +
      (parts.length ? "/" + parts.join("/") : "") +
      (query.size ? "?" + query.toString() : ""),
    options,
  );
}
