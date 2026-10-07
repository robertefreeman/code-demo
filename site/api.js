const GENERATION_TIMEOUT_MS = 100_000;

export class ApiResponseError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

async function readJsonResponse(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiResponseError(
      "The AI service returned an unreadable response. Try again later.",
      response.status,
    );
  }

  if (response.status !== 200) {
    throw new ApiResponseError(
      result.message || "Generation failed. Try again.",
      response.status,
    );
  }

  return result;
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timed out.", "TimeoutError")),
    GENERATION_TIMEOUT_MS / 1000,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return await readJsonResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function createApiConnection(apiUrl) {
  return {
    generateArtwork(idea, verificationToken) {
      return postJson(apiUrl, {
        prompt: idea,
        token: verificationToken,
      });
    },
  };
}
