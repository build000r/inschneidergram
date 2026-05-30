const INSTAGRAM_HOST_RE = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i;

export function normalizeInstagramHandle(input: string): string {
  let value = input.trim();

  if (INSTAGRAM_HOST_RE.test(value)) {
    value = value.replace(INSTAGRAM_HOST_RE, "");
    value = value.split(/[/?#]/, 1)[0] ?? "";
  }

  value = value.replace(/^@+/, "").toLowerCase();

  if (!/^[a-z0-9._]{1,30}$/.test(value)) {
    throw new Error(`Invalid Instagram handle: ${input}`);
  }

  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
    throw new Error(`Invalid Instagram handle: ${input}`);
  }

  return value;
}
