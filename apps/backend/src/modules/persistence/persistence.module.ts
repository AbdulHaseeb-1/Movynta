import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
/** Provides the SQLite connection and its migrations to the rest of the app. */
})
export class PersistenceModule {}
