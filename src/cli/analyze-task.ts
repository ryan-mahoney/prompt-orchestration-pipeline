import path from "node:path";
import { analyzeTask } from "../task-analysis/index.ts";

export async function analyzeTaskFile(taskPath: string): Promise<void> {
  const absolutePath = path.resolve(taskPath);

  let code: string;
  try {
    code = await Bun.file(absolutePath).text();
  } catch (err) {
    const isNotFound =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (isNotFound) {
      console.error(`Error: File not found: ${absolutePath}`);
      process.exit(1);
    }
    throw err;
  }

  try {
    const result = analyzeTask(code, absolutePath);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    const isDev =
      process.env.NODE_ENV === "development" || process.env.DEBUG_TASK_ANALYSIS === "1";
    if (isDev && err instanceof Error && err.stack) {
      console.error(err.stack);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}
