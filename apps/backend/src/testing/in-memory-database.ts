import { DatabaseService } from "../modules/persistence/database.service.js";
import { loadAppConfig } from "../config/configuration.js";
import { TEST_AUTH_SECRET } from "./constants.js";

/** Opens a migrated in-memory database for unit tests that exercise repositories directly. */
export function openInMemoryDatabase(): DatabaseService {
  const config = loadAppConfig({
    NODE_ENV: "test",
    AUTH_SECRET: TEST_AUTH_SECRET,
    DATABASE_URL: ":memory:",
    AGENTS_ENABLED: "false",
  });
  const database = new DatabaseService(config);
  database.open(":memory:");
  return database;
}
