import type { HarnessDescriptor, HarnessName } from "../types.ts";
import { claudeDescriptor } from "./claude.ts";
import { codexDescriptor } from "./codex.ts";
import { opencodeDescriptor } from "./opencode.ts";

export const DESCRIPTORS: Record<HarnessName, HarnessDescriptor> = {
  claude: claudeDescriptor,
  codex: codexDescriptor,
  opencode: opencodeDescriptor,
};
