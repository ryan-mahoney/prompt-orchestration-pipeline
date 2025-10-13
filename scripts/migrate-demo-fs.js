#!/usr/bin/env node

/**
 * Migration script to convert demo data from slug-based to ID-based storage
 *
 * This script:
 * 1. Scans for slug-based folders (like "content-generation")
 * 2. Extracts metadata to determine job IDs
 * 3. Moves folders to use job IDs as directory names
 * 4. Creates a manifest in each new folder
 *
 * Usage: node scripts/migrate-demo-fs.js
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const DEMO_DATA_DIR = path.join(PROJECT_ROOT, "demo", "pipeline-data");
const STAGES = ["pending", "current", "complete", "rejected"];

/**
 * Extract job ID from existing job data or generate a new one
 */
async function extractJobId(jobDir, stage) {
  try {
    // Try to read existing job data files
    const possibleFiles = ["job.json", "tasks-status.json", "seed.json"];

    for (const filename of possibleFiles) {
      const filePath = path.join(jobDir, filename);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(content);

        // Look for existing job ID
        if (data.id) {
          console.log(`Found existing job ID ${data.id} in ${filename}`);
          return data.id;
        }

        // Look for job ID in pipeline data
        if (data.pipeline?.jobId) {
          console.log(
            `Found pipeline job ID ${data.pipeline.jobId} in ${filename}`
          );
          return data.pipeline.jobId;
        }
      } catch (err) {
        // File doesn't exist or invalid JSON, continue
      }
    }

    // Generate a new job ID if none found
    const { generateJobId } = await import("../src/utils/id-generator.js");
    const newJobId = generateJobId();
    console.log(`Generated new job ID ${newJobId} for ${jobDir}`);
    return newJobId;
  } catch (error) {
    console.error(`Error extracting job ID from ${jobDir}:`, error);
    throw error;
  }
}

/**
 * Create a manifest file for the job
 */
async function createManifest(newDir, oldDirName, jobId) {
  const manifest = {
    jobId,
    migratedFrom: oldDirName,
    migratedAt: new Date().toISOString(),
    migrationVersion: "1.0.0",
  };

  const manifestPath = path.join(newDir, "migration-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Created migration manifest: ${manifestPath}`);
}

/**
 * Migrate a single directory from slug to job ID
 */
async function migrateDirectory(dirPath, stage) {
  const dirName = path.basename(dirPath);

  // Skip if already looks like a job ID (alphanumeric, length 6-30)
  const jobIdPattern = /^[a-zA-Z0-9]{6,30}$/;
  if (jobIdPattern.test(dirName)) {
    console.log(`Skipping ${dirName} - appears to be a job ID already`);
    return;
  }

  // Skip .gitkeep files
  if (dirName === ".gitkeep") {
    return;
  }

  console.log(`\nMigrating directory: ${dirPath}`);

  try {
    // Extract or generate job ID
    const jobId = await extractJobId(dirPath, stage);
    const newPath = path.join(path.dirname(dirPath), jobId);

    // Check if target already exists
    try {
      await fs.access(newPath);
      console.warn(
        `Target directory ${newPath} already exists, skipping migration`
      );
      return;
    } catch {
      // Target doesn't exist, proceed
    }

    // Create new directory
    await fs.mkdir(newPath, { recursive: true });

    // Copy all files from old directory to new directory
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(dirPath, entry.name);
      const destPath = path.join(newPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively copy subdirectories
        await fs.mkdir(destPath, { recursive: true });
        await copyDirectory(srcPath, destPath);
      } else {
        // Copy files
        await fs.copyFile(srcPath, destPath);
        console.log(`  Copied: ${entry.name}`);
      }
    }

    // Create migration manifest
    await createManifest(newPath, dirName, jobId);

    // Remove old directory
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`  Removed old directory: ${dirName}`);
    console.log(`  Migration complete: ${dirName} -> ${jobId}`);
  } catch (error) {
    console.error(`Failed to migrate ${dirPath}:`, error);
  }
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Main migration function
 */
async function migrateDemoData() {
  console.log("Starting demo data migration...");
  console.log(`Demo data directory: ${DEMO_DATA_DIR}`);

  for (const stage of STAGES) {
    const stageDir = path.join(DEMO_DATA_DIR, stage);
    console.log(`\n=== Processing stage: ${stage} ===`);

    try {
      const entries = await fs.readdir(stageDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(stageDir, entry.name);
          await migrateDirectory(dirPath, stage);
        }
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log(`Stage directory ${stageDir} does not exist, skipping`);
      } else {
        console.error(`Error processing stage ${stage}:`, error);
      }
    }
  }

  console.log("\n=== Migration complete ===");
  console.log("Please verify the migrated data and update any documentation.");
}

/**
 * Show migration statistics
 */
async function showMigrationStats() {
  console.log("\n=== Migration Statistics ===");

  for (const stage of STAGES) {
    const stageDir = path.join(DEMO_DATA_DIR, stage);

    try {
      const entries = await fs.readdir(stageDir, { withFileTypes: true });
      const dirs = entries.filter(
        (entry) => entry.isDirectory && entry.name !== ".gitkeep"
      );

      console.log(`${stage}: ${dirs.length} directories`);

      for (const dir of dirs) {
        const dirPath = path.join(stageDir, dir.name);
        try {
          const manifestPath = path.join(dirPath, "migration-manifest.json");
          const manifestContent = await fs.readFile(manifestPath, "utf8");
          const manifest = JSON.parse(manifestContent);
          console.log(
            `  ${dir.name} -> migrated from: ${manifest.migratedFrom}`
          );
        } catch {
          // No manifest found, assume it's always been a job ID
          console.log(`  ${dir.name} -> original job ID`);
        }
      }
    } catch (error) {
      console.log(`${stage}: directory not found`);
    }
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === "stats") {
    await showMigrationStats();
  } else {
    await migrateDemoData();
    await showMigrationStats();
  }
}

export { migrateDemoData, showMigrationStats };
