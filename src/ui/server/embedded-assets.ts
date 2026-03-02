export interface EmbeddedAssetEntry {
  path: string;
  mime: string;
}

// Generated during UI build for embedded/binary distributions.
export const embeddedAssets: Record<string, EmbeddedAssetEntry> = {};
