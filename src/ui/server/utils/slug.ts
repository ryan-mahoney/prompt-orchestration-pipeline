const MAX_SLUG_LENGTH = 47;

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

export function generateSlug(name: string): string {
  const normalized = trimHyphens(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-"),
  ).slice(0, MAX_SLUG_LENGTH);
  return trimHyphens(normalized) || "pipeline";
}

export function ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let counter = 2;
  while (true) {
    const suffix = `-${counter}`;
    const candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!existingSlugs.has(candidate)) return candidate;
    counter += 1;
  }
}
