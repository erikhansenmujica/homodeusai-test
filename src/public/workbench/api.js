export class ApiError extends Error {
  constructor(code, status, payload) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export function safeRequest(path, options) {
  return fetch(path, options).then(function (response) {
    return response.text().then(function (raw) {
      var payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch (_error) {
        throw new ApiError("invalid_response", response.status, {});
      }
      if (!response.ok) {
        throw new ApiError(
          typeof payload.error === "string" ? payload.error : "request_failed",
          response.status,
          payload
        );
      }
      return payload;
    });
  });
}

export async function waitForReadiness(options) {
  var deadline = Date.now() + (options && options.timeoutMs || 180000);
  var intervalMs = options && options.intervalMs || 250;
  var lastPayload = null;
  while (Date.now() < deadline) {
    try {
      return await safeRequest("/readyz");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 503) throw error;
      lastPayload = error.payload;
      if (lastPayload && lastPayload.status === "failed") throw error;
    }
    await new Promise(function (resolve) {
      window.setTimeout(resolve, intervalMs);
    });
  }
  throw new ApiError("readiness_timeout", 503, lastPayload || {});
}
