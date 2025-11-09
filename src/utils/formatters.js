/**
 * Format currency with 4 decimal places, trimming trailing zeros
 * @param {number} x - The number to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency4(x) {
  if (typeof x !== "number" || x === 0) return "$0.0000";
  const formatted = x.toFixed(4);
  // Trim trailing zeros and unnecessary decimal point
  return `$${formatted.replace(/\.?0+$/, "")}`;
}

/**
 * Format tokens in compact notation (k, M suffixes)
 * @param {number} n - The number of tokens to format
 * @returns {string} Formatted tokens string
 */
export function formatTokensCompact(n) {
  if (typeof n !== "number" || n === 0) return "0 tok";

  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M tokens`;
  } else if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
  }
  return `${n} tokens`;
}
