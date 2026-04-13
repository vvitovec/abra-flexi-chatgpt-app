import { runServer } from "./server.js";

runServer().catch((error) => {
  console.error("Fatal error in Flexi MCP harness:", error);
  process.exit(1);
});
