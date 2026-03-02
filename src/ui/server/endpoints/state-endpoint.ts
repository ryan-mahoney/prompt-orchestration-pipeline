import { buildSnapshotFromFilesystem } from "../../state/snapshot";
import { getState } from "../../state/change-tracker";
import { sendJson } from "../utils/http-utils";

export async function handleApiState(): Promise<Response> {
  const state = getState();
  if (state.changeCount > 0 || state.watchedPaths.length > 0) {
    return sendJson(200, { ok: true, data: state });
  }
  return sendJson(200, { ok: true, data: await buildSnapshotFromFilesystem() });
}
