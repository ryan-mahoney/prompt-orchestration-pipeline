#!/usr/bin/env node

/**
 * Migration script for transforming demo data from legacy artifacts to new files.* schema
 *
 * This script:
 * 1. Scans existing demo jobs for legacy artifacts
 * 2. Transforms tasks-status.json to use new files.* schema
 * 3. Ensures task subdirectories exist with proper structure
 * 4. Moves any legacy artifact files from job root to task subdirectories
 * 5. Provides dry-run mode for safe preview
 *
 * Usage: node scripts/migrate-demo-files.js [--dry-run] [--data-dir=demo]
 */

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    dataDir: "demo",
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--data-dir=")) {
      options.dataDir = arg.split("=")[1];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/migrate-demo-files.js [options]

Options:
  --dry-run     Preview changes without executing
  --data-dir    Path to demo data directory (default: "demo")
  --help, -h    Show this help message

Example:
  node scripts/migrate-demo-files.js --dry-run
  node scripts/migrate-demo-files.js --data-dir=/path/to/demo
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Log migration actions
 */
function log(level, message, isDryRun = false) {
  const prefix = isDryRun ? "[DRY RUN] " : "";
  console.log(`${prefix}${level}: ${message}`);
}

/**
 * Create a unique filename if conflicts exist
 */
function getUniqueFilename(targetDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let uniqueName = filename;
  let counter = 1;

  while (existsSync(path.join(targetDir, uniqueName))) {
    uniqueName = `${base}_${counter}${ext}`;
    counter++;
  }

  return uniqueName;
}

/**
 * Ensure task subdirectories exist
 */
async function ensureTaskDirectories(jobDir, taskName) {
  const taskDir = path.join(jobDir, "tasks", taskName);
  const subdirs = ["artifacts", "logs", "tmp"];

  for (const subdir of subdirs) {
    const fullPath = path.join(taskDir, subdir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
}

/**
 * Migrate a single job's artifacts
 */
async function migrateJob(jobDir, jobId, options) {
  const statusFile = path.join(jobDir, "tasks-status.json");

  try {
    const statusContent = await fs.readFile(statusFile, "utf8");
    const status = JSON.parse(statusContent);

    let hasChanges = false;
    const migrationReport = {
      jobId,
      tasksMigrated: [],
      filesMoved: [],
    };

    // Process each task
    for (const [taskName, task] of Object.entries(status.tasks || {})) {
      const taskReport = {
        taskName,
        artifactsFound: [],
        artifactsMoved: [],
        schemaUpdated: false,
      };

      // Ensure task directories exist
      await ensureTaskDirectories(jobDir, taskName);

      // Handle legacy artifacts
      if (task.artifacts && Array.isArray(task.artifacts)) {
        taskReport.artifactsFound = [...task.artifacts];

        // Move files from job root to task subdirectory if needed
        for (const artifactFile of task.artifacts) {
          const sourcePath = path.join(jobDir, artifactFile);
          const targetPath = path.join(
            jobDir,
            "tasks",
            taskName,
            "artifacts",
            artifactFile
          );

          // Check if file exists in job root and needs to be moved
          if (existsSync(sourcePath) && !existsSync(targetPath)) {
            const uniqueFilename = getUniqueFilename(
              path.dirname(targetPath),
              artifactFile
            );
            const finalTargetPath = path.join(
              path.dirname(targetPath),
              uniqueFilename
            );

            if (!options.dryRun) {
              await fs.rename(sourcePath, finalTargetPath);
            }

            taskReport.artifactsMoved.push({
              from: artifactFile,
              to: uniqueFilename,
            });
            migrationReport.filesMoved.push({
              jobId,
              taskName,
              from: sourcePath,
              to: finalTargetPath,
            });
          }
        }

        // Transform schema: artifacts[] -> files.artifacts[]
        if (!task.files) {
          task.files = {};
        }

        // Use moved filenames if they were renamed due to conflicts
        const finalArtifacts =
          taskReport.artifactsMoved.map((move) => move.to).length > 0
            ? taskReport.artifactsMoved.map((move) => move.to)
            : task.artifacts;

        task.files.artifacts = finalArtifacts;
        delete task.artifacts; // Remove legacy field
        taskReport.schemaUpdated = true;
        hasChanges = true;
      }

      // Ensure files object has all required arrays
      if (task.files) {
        if (!task.files.artifacts) task.files.artifacts = [];
        if (!task.files.logs) task.files.logs = [];
        if (!task.files.tmp) task.files.tmp = [];
      } else {
        task.files = { artifacts: [], logs: [], tmp: [] };
        hasChanges = true;
        taskReport.schemaUpdated = true;
      }

      if (taskReport.artifactsFound.length > 0 || taskReport.schemaUpdated) {
        migrationReport.tasksMigrated.push(taskReport);
      }
    }

    // Write updated status file if changes were made
    if (hasChanges && !options.dryRun) {
      await fs.writeFile(statusFile, JSON.stringify(status, null, 2), "utf8");
    }

    return migrationReport;
  } catch (error) {
    log(
      "ERROR",
      `Failed to migrate job ${jobId}: ${error.message}`,
      options.dryRun
    );
    throw error;
  }
}

/**
 * Scan for jobs in demo data directories
 */
async function scanJobs(dataDir) {
  const jobs = [];
  const locations = ["current", "complete", "pending"];

  for (const location of locations) {
    const locationDir = path.join(dataDir, "pipeline-data", location);

    try {
      const entries = await fs.readdir(locationDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== ".gitkeep") {
          const jobDir = path.join(locationDir, entry.name);
          const statusFile = path.join(jobDir, "tasks-status.json");

          if (existsSync(statusFile)) {
            jobs.push({
              jobId: entry.name,
              jobDir,
              location,
            });
          }
        }
      }
    } catch (error) {
      // Directory might not exist, which is fine
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return jobs;
}

/**
 * Main migration function
 */
export async function migrateDemoFiles(options = {}) {
  const opts = {
    dryRun: false,
    dataDir: "demo",
    ...options,
  };

  log(
    "INFO",
    `Starting migration${opts.dryRun ? " (dry run)" : ""}`,
    opts.dryRun
  );
  log("INFO", `Data directory: ${opts.dataDir}`, opts.dryRun);

  // Scan for jobs
  const jobs = await scanJobs(opts.dataDir);
  log("INFO", `Found ${jobs.length} jobs to process`, opts.dryRun);

  if (jobs.length === 0) {
    log("INFO", "No jobs found. Nothing to migrate.", opts.dryRun);
    return {
      totalJobs: 0,
      jobsMigrated: 0,
      filesMoved: 0,
      report: [],
    };
  }

  // Migrate each job
  const migrationReport = [];
  let totalFilesMoved = 0;

  for (const job of jobs) {
    log("INFO", `Processing job: ${job.jobId} (${job.location})`, opts.dryRun);

    try {
      const jobReport = await migrateJob(job.jobDir, job.jobId, opts);
      migrationReport.push(jobReport);
      totalFilesMoved += jobReport.filesMoved.length;

      if (jobReport.tasksMigrated.length > 0) {
        log(
          "INFO",
          `  Migrated ${jobReport.tasksMigrated.length} tasks, moved ${jobReport.filesMoved.length} files`,
          opts.dryRun
        );
      } else {
        log("INFO", "  No migration needed", opts.dryRun);
      }
    } catch (error) {
      log("ERROR", `  Failed to migrate job: ${error.message}`, opts.dryRun);
      // Continue with other jobs
    }
  }

  const summary = {
    totalJobs: jobs.length,
    jobsMigrated: migrationReport.filter((r) => r.tasksMigrated.length > 0)
      .length,
    filesMoved: totalFilesMoved,
    report: migrationReport,
  };

  // Print summary
  log("INFO", "\n=== Migration Summary ===", opts.dryRun);
  log("INFO", `Total jobs processed: ${summary.totalJobs}`, opts.dryRun);
  log("INFO", `Jobs migrated: ${summary.jobsMigrated}`, opts.dryRun);
  log("INFO", `Files moved: ${summary.filesMoved}`, opts.dryRun);

  if (opts.dryRun) {
    log("INFO", "\nDry run completed. No files were modified.", opts.dryRun);
    log("INFO", "Run without --dry-run to execute the migration.", opts.dryRun);
  } else {
    log("INFO", "\nMigration completed successfully!", opts.dryRun);
  }

  return summary;
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();

  try {
    await migrateDemoFiles(options);
    process.exit(0);
  } catch (error) {
    log("ERROR", `Migration failed: ${error.message}`, options.dryRun);
    console.error(error);
    process.exit(1);
  }
}
