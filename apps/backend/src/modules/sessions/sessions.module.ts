import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module.js";
import { SessionsController } from "./sessions.controller.js";
import { SessionsRepository } from "./sessions.repository.js";
import { SessionsService } from "./sessions.service.js";

/** The sessions feature: chat sessions and their stored history. */
@Module({
  imports: [ProjectsModule],
  controllers: [SessionsController],
  providers: [SessionsRepository, SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
