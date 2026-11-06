// Injected by esbuild into every module of the service worker bundle: Node globals the shared server code
// expects. `Buffer` comes from the browser port of Node's Buffer; `process.env` is empty.
import { Buffer } from "buffer";

const process = { env: { NODE_ENV: "production" } as Record<string, string | undefined>, versions: {} as Record<string, string> };
(globalThis as { STYLEAI_WEB?: boolean }).STYLEAI_WEB = true;

export { Buffer, process };
