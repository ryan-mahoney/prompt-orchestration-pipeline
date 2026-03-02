import { unzipSync } from "fflate";

export interface ZipExtractionResult {
  seedObject: Record<string, unknown>;
  artifacts: Array<{ filename: string; content: Uint8Array }>;
}

export async function extractSeedZip(zipBuffer: Uint8Array): Promise<ZipExtractionResult> {
  const extracted = unzipSync(zipBuffer);
  const seedEntry = Object.entries(extracted).find(([filename]) => filename.endsWith("seed.json"));
  if (!seedEntry) {
    throw new Error("seed zip must contain seed.json");
  }

  const [seedFilename, seedContent] = seedEntry;
  const seedObject = JSON.parse(new TextDecoder().decode(seedContent)) as Record<string, unknown>;
  const artifacts = Object.entries(extracted)
    .filter(([filename]) => filename !== seedFilename)
    .map(([filename, content]) => ({ filename, content }));

  return { seedObject, artifacts };
}
