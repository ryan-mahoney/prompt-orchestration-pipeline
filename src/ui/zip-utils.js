import { unzipSync } from "fflate";
import path from "node:path";

/**
 * Extract seed JSON and artifacts from a zip buffer using fflate
 * @param {Buffer|Uint8Array} zipBuffer - Buffer containing zip data
 * @returns {Promise<{seedObject: Object, artifacts: Array<{filename: string, content: Buffer}>}>}
 */
export async function extractSeedZip(zipBuffer) {
  // Normalize to Uint8Array for fflate
  const zipData = Buffer.isBuffer(zipBuffer)
    ? new Uint8Array(zipBuffer)
    : zipBuffer;

  console.log("[ZIP] Starting real zip parsing", {
    bufferSize: zipData.length,
  });

  try {
    // Check if this looks like a valid zip by looking for PK signature
    if (zipData.length < 4 || zipData[0] !== 0x50 || zipData[1] !== 0x4b) {
      throw new Error("Invalid ZIP file signature");
    }

    // Use fflate to extract all entries
    const entries = unzipSync(zipData);
    const artifacts = [];
    let seedObject = null;
    let seedJsonCount = 0;

    console.log("[ZIP] Extracted entries from zip", {
      entryCount: Object.keys(entries).length,
      entryNames: Object.keys(entries),
    });

    // Process each entry
    for (const [entryName, rawContent] of Object.entries(entries)) {
      // Skip directory entries (names ending with /)
      if (entryName.endsWith("/")) {
        console.log("[ZIP] Skipping directory entry", { entryName });
        continue;
      }

      // Derive filename using basename (flatten directory structure)
      const filename = path.basename(entryName);
      console.log("[ZIP] Processing entry", { entryName, filename });

      // Convert Uint8Array to Buffer
      const content = Buffer.from(rawContent);

      // Add to artifacts
      artifacts.push({ filename, content });

      // Check if this is seed.json
      if (filename === "seed.json") {
        seedJsonCount++;
        try {
          const jsonContent = content.toString("utf8");
          seedObject = JSON.parse(jsonContent);
          console.log("[ZIP] Successfully parsed seed.json", {
            seedName: seedObject.name,
            seedPipeline: seedObject.pipeline,
          });
        } catch (parseError) {
          console.error("[ZIP] Failed to parse seed.json", {
            error: parseError.message,
            filename,
          });
          throw new Error("Invalid JSON");
        }
      }
    }

    // Validate that we found at least one seed.json
    if (seedJsonCount === 0) {
      throw new Error("seed.json not found in zip");
    }

    if (seedJsonCount > 1) {
      console.log(
        "[ZIP] Warning: multiple seed.json files found, using last one",
        {
          count: seedJsonCount,
        }
      );
    }

    console.log("[ZIP] Zip extraction completed", {
      artifactCount: artifacts.length,
      artifactNames: artifacts.map((a) => a.filename),
      seedKeys: seedObject ? Object.keys(seedObject) : [],
      seedJsonCount,
    });

    return { seedObject, artifacts };
  } catch (error) {
    console.error("[ZIP] Zip extraction failed", {
      error: error.message,
      bufferSize: zipData.length,
    });
    throw error;
  }
}
