import { randomBytes } from "node:crypto";

console.log(`v1:${randomBytes(32).toString("hex")}`);
