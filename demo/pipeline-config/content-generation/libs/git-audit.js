// Git-based audit trail for pipeline runs using hologit
// Creates a DAG visualization of content generation progression

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// Module-level state for current job
let repo = null;
let git = null;
let jobBranchRef = null;
let codeParentCommit = null;
let isFirstCommit = true;

/**
 * Initialize hologit repo - lazy loaded to avoid issues if hologit not installed
 */
async function getRepo() {
  if (!repo) {
    const { Repo } = await import('hologit');
    repo = await Repo.getFromEnvironment();
    git = await repo.getGit();
  }
  return { repo, git };
}

/**
 * Initialize audit branch for a new pipeline job
 * Creates initial commit with seed data and sets up the branch
 *
 * @param {string} jobId - Unique job identifier
 * @param {string} pipelineSlug - Pipeline name (e.g., 'content-generation')
 * @param {object} seedData - Original seed data to include in first commit
 * @param {string} codeRef - Reference to code branch (default: HEAD)
 * @returns {Promise<string>} Branch ref path
 */
export async function initAuditBranch(jobId, pipelineSlug, seedData = {}, codeRef = 'HEAD') {
  const { repo, git } = await getRepo();
  const { TreeObject } = await import('hologit');

  // Create initial commit with seed data
  const tree = new TreeObject(repo);
  await tree.writeChild('seed.json', JSON.stringify(seedData, null, 2));
  const treeHash = await tree.write();

  const initialCommit = await git.commitTree(treeHash, {
    m: `initialized ${pipelineSlug}/${jobId}`
  });

  // Capture code branch as second parent for lineage
  codeParentCommit = await git.revParse(codeRef);

  // Set up branch ref
  jobBranchRef = `refs/heads/runs/${pipelineSlug}/${jobId}`;
  await git.updateRef(jobBranchRef, initialCommit);

  isFirstCommit = true;

  console.log(`[git-audit] Initialized branch: ${jobBranchRef}`);
  console.log(`[git-audit] Code parent: ${codeParentCommit}`);

  return jobBranchRef;
}

/**
 * Commit task artifacts to the audit branch
 * First commit includes code branch as second parent to show lineage
 * Accumulates files from previous commits rather than replacing
 *
 * @param {string} taskName - Name of the task (e.g., 'research', 'analysis')
 * @param {object} artifacts - Map of filename -> content to commit
 * @param {object} metadata - Optional metadata for commit body (prompts, timing, etc.)
 * @returns {Promise<string>} Commit hash
 */
export async function commitTaskArtifacts(taskName, artifacts, metadata = {}) {
  if (!jobBranchRef) {
    console.warn('[git-audit] No audit branch initialized, skipping commit');
    return null;
  }

  const { repo, git } = await getRepo();

  // Load existing tree from current branch head to accumulate files
  const currentHead = await git.revParse(jobBranchRef);
  const { TreeObject } = await import('hologit');
  const tree = await TreeObject.createFromRef(repo, currentHead);

  // Add new artifacts to the existing tree
  for (const [filename, content] of Object.entries(artifacts)) {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await tree.writeChild(`${taskName}/${filename}`, contentStr);
  }

  const treeHash = await tree.write();

  // Build parent list - include code parent on first real commit
  const parents = [currentHead];
  if (isFirstCommit && codeParentCommit) {
    parents.push(codeParentCommit);
    isFirstCommit = false;
  }

  // Build commit message with metadata in body
  let message = taskName;
  let body = '';

  if (metadata.prompt) {
    body += `## Prompt\n\n${metadata.prompt}\n\n`;
  }
  if (metadata.systemPrompt) {
    body += `## System Prompt\n\n${metadata.systemPrompt}\n\n`;
  }
  if (metadata.model) {
    body += `## Model\n\n${metadata.model}\n\n`;
  }
  if (metadata.executionTimeMs) {
    body += `## Execution Time\n\n${metadata.executionTimeMs}ms\n\n`;
  }
  if (metadata.tokenUsage) {
    body += `## Token Usage\n\n${JSON.stringify(metadata.tokenUsage, null, 2)}\n\n`;
  }

  const fullMessage = body ? `${message}\n\n${body}` : message;

  // Create commit
  const commitHash = await git.commitTree(treeHash, {
    p: parents,
    m: fullMessage
  });

  // Update branch ref
  await git.updateRef(jobBranchRef, commitHash);

  console.log(`[git-audit] Committed ${taskName}: ${commitHash.substring(0, 8)}`);

  return commitHash;
}

/**
 * Finalize the audit branch with a summary commit
 *
 * @param {object} summary - Final summary data
 * @returns {Promise<string>} Final commit hash
 */
export async function finalizeAuditBranch(summary = {}) {
  if (!jobBranchRef) {
    console.warn('[git-audit] No audit branch initialized, skipping finalize');
    return null;
  }

  const { repo, git } = await getRepo();

  // Load existing tree and add summary
  const currentHead = await git.revParse(jobBranchRef);
  const { TreeObject } = await import('hologit');
  const tree = await TreeObject.createFromRef(repo, currentHead);
  await tree.writeChild('_summary.json', JSON.stringify(summary, null, 2));

  const treeHash = await tree.write();

  const commitHash = await git.commitTree(treeHash, {
    p: [currentHead],
    m: `completed`
  });

  await git.updateRef(jobBranchRef, commitHash);

  console.log(`[git-audit] Finalized: ${commitHash.substring(0, 8)}`);
  console.log(`[git-audit] View with: git log --graph --oneline ${jobBranchRef}`);

  // Reset state for next job
  const finalRef = jobBranchRef;
  jobBranchRef = null;
  codeParentCommit = null;
  isFirstCommit = true;

  return { commitHash, branchRef: finalRef };
}

/**
 * Get current branch ref (for external use)
 */
export function getCurrentBranchRef() {
  return jobBranchRef;
}
