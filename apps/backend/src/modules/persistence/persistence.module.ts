import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

@Global()
/** Provides the SQLite connection and its migrations to the rest of the app. */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class PersistenceModule {}
