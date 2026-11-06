// Structured, privacy-aware logging: no request bodies, no e-mails, no prompts, no image data.
type Fields = Record<string, string | number | boolean | null | undefined>;

let silent = process.env.NODE_ENV === "test" || !!process.env.VITEST;

function write(level: "info" | "warn" | "error", msg: string, fields: Fields = {}) {
  if (silent) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  info: (msg: string, f?: Fields) => write("info", msg, f),
  warn: (msg: string, f?: Fields) => write("warn", msg, f),
  error: (msg: string, f?: Fields) => write("error", msg, f),
  setSilent: (v: boolean) => (silent = v),
};
