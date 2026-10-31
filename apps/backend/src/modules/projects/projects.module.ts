import { Module } from "@nestjs/common";
import { ProjectAccessService } from "./project-access.service.js";

@Module({
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class ProjectsModule {}
