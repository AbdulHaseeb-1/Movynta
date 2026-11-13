import { Module } from "@nestjs/common";
import { ProjectAccessService } from "./project-access.service.js";
import { ProjectScenesService } from "./project-scenes.service.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";
import { SceneScriptService } from "./scene-script.service.js";

/** The projects feature: the project library, scenes and history. */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectAccessService, ProjectsRepository, ProjectsService, ProjectScenesService, SceneScriptService],
  exports: [ProjectAccessService, ProjectScenesService, ProjectsService],
})
export class ProjectsModule {}
