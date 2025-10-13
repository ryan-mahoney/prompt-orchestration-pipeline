/**
 * Utility functions for generating random IDs
 * @module utils/id-generator
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a random job ID using crypto.randomBytes
 * @param {number} [length=12] - Length of the ID in bytes
 * @returns {string} Random alphanumeric ID
 */
export function generateJobId(length = 12) {
  const bytes = randomBytes(length);
  return bytes
    .toString("base64")
    .replace(/[+/=]/g, "") // Remove URL-unsafe characters
    .substring(0, length); // Ensure consistent length
}

/**
 * Generate a random job ID with a prefix
 * @param {string} [prefix='job'] - Prefix for the ID
 * @param {number} [length=8] - Length of the random part
 * @returns {string} Random ID with prefix
 */
export function generateJobIdWithPrefix(prefix = "job", length = 8) {
  const randomPart = generateJobId(length);
  return `${prefix}_${randomPart}`;
}
