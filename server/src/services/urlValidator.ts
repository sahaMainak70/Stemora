export const ALLOWED_HOST_SUFFIXES = ["youtube.com"];
export const ALLOWED_EXACT_HOSTS = ["youtu.be"];
export const MAX_URL_LENGTH = 2048;

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; code: "INVALID_URL"; message: string };

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    ALLOWED_EXACT_HOSTS.includes(host) ||
    ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    )
  );
}

export function validateMediaUrl(rawUrl: string): UrlValidationResult {
  const url = rawUrl.trim();

  if (url === "") {
    return { ok: false, code: "INVALID_URL", message: "a url string is required" };
  }

  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, code: "INVALID_URL", message: "url is too long" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "url is not a valid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "INVALID_URL", message: "only http(s) URLs are supported" };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, code: "INVALID_URL", message: "urls with embedded credentials are not supported" };
  }

  if (!isAllowedHost(parsed.hostname)) {
    return { ok: false, code: "INVALID_URL", message: `domain not allowed: ${parsed.hostname}` };
  }

  return { ok: true, url };
}