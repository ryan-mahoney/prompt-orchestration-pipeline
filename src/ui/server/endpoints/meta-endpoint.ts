import { sendJson } from "../utils/http-utils";
import pkg from "../../../../package.json";

export const PROTOCOL_VERSION = 1;

export function handleMeta(): Response {
  return sendJson(200, {
    ok: true,
    data: { name: pkg.name, version: pkg.version, protocolVersion: PROTOCOL_VERSION },
  });
}
