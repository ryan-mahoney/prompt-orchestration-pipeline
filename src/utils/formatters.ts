export function formatCurrency4(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

export function formatTokensCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 tok";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tok`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k tok`;
  return `${Math.round(value)} tok`;
}
