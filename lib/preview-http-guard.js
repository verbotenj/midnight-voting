export function assertPreviewRequest(request, write = false) {
  const port = request.socket.localPort;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const host = request.headers.host;
  const origin = request.headers.origin;
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
  if (!local || !hosts.includes(host) || (origin && origin !== `http://${host}`)
      || request.headers["sec-fetch-site"] === "cross-site") {
    throw Object.assign(new Error("LOCAL_SAME_ORIGIN_REQUIRED"), { status: 403 });
  }
  if (write && (!origin || request.headers["content-type"]?.split(";")[0] !== "application/json"
      || request.headers["x-midnight-preview-action"] !== "explicit")) {
    throw Object.assign(new Error("EXPLICIT_SAME_ORIGIN_JSON_ACTION_REQUIRED"), { status: 403 });
  }
}
