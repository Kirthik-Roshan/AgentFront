export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${provider} request failed with HTTP ${status}.`);
    this.name = "ProviderHttpError";
  }
}

const maximumProviderResponseBytes = 2_000_000;

const readBoundedText = async (provider: string, response: Response): Promise<string> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumProviderResponseBytes) {
    await response.body?.cancel();
    throw new Error(`${provider} response exceeded the 2000000-byte safety limit.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumProviderResponseBytes) {
      await reader.cancel();
      throw new Error(`${provider} response exceeded the 2000000-byte safety limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

export async function requestJson<T>(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await readBoundedText(provider, response);
    if (!response.ok) throw new ProviderHttpError(provider, response.status, text.slice(0, 1_000));
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}
