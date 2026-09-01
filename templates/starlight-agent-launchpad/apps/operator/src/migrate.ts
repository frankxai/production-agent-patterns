import { loadConfig } from "./config";
import { migrateDatabase } from "./store/postgres";

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

await migrateDatabase(config.databaseUrl);
console.info("Launchpad receipt schema is current.");
