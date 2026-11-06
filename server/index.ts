import { loadConfig } from "./config";
import { startServer } from "./main";

startServer(loadConfig()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
