/**
 * Slug utility functions for pipeline type creation
 */

/**
 * Generate a URL-friendly slug from a pipeline name
 * @param {string} name - The pipeline name
 * @returns {string} A URL-friendly slug (max 47 chars)
 */
export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 47);
}

/**
 * Ensure slug uniqueness by appending numeric suffixes
 * @param {string} baseSlug - The base slug to make unique
 * @param {Set<string>} existingSlugs - Set of existing slugs
 * @returns {string} A unique slug
 */
export function ensureUniqueSlug(baseSlug, existingSlugs) {
  if (!existingSlugs.has(baseSlug)) return baseSlug;
  let suffix = 1;
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix++;
  }
  return `${baseSlug}-${suffix}`;
}
