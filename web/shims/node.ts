// Stand-ins for Node-only modules that the shared server code imports but never calls in the browser
// edition (static file serving, files on disk). Calling one is a bug, so they fail loudly.
const unavailable = (name: string) => () => {
  throw new Error(`${name} ist in der Browser-Version nicht verfügbar.`);
};

export const readFile = unavailable("readFile");
export const writeFile = unavailable("writeFile");
export const mkdir = unavailable("mkdir");
export const rm = unavailable("rm");
export const unlink = unavailable("unlink");
export const readFileSync = unavailable("readFileSync");
export const writeFileSync = unavailable("writeFileSync");
export const mkdirSync = () => undefined;
export const existsSync = () => false;
export const serveStatic = unavailable("serveStatic");
export class DatabaseSync {
  constructor() {
    unavailable("node:sqlite")();
  }
}

const join = (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
export const path = { join, resolve: join, sep: "/" };
export default path;
