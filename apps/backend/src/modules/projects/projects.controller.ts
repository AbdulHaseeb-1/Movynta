import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { ApiBearerAuth, ApiNotFoundResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ResourceIdPipe } from "../../common/pipes/resource-id.pipe.js";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import { ASSET_RESOURCE_ID_PATTERN, PROJECT_RESOURCE_ID_PATTERN } from "../../shared/constants/resource-ids.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
  CreateProjectDto,
  ImportModelQueryDto,
  ListProjectsQueryDto,
  RecordSceneEditDto,
  UpdateProjectDto,
} from "./dto/index.js";
import { ProjectsService } from "./projects.service.js";
import { SceneScriptService } from "./scene-script.service.js";
import type { ProjectConversation, ProjectView, SceneImport, SceneStep } from "./projects.types.js";
import { SceneHistoryDto, CommitSceneHistoryDto } from "./dto/index.js";

const projectIdPipe = new ResourceIdPipe(PROJECT_RESOURCE_ID_PATTERN);
const assetIdPipe = new ResourceIdPipe(ASSET_RESOURCE_ID_PATTERN);

/** HTTP endpoints for projects, their scenes, history, measurements and conversations. The logic lives in ProjectsService. */
@ApiTags("projects")
@ApiBearerAuth()
@Controller({ path: "projects", version: "1" })
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly scripts: SceneScriptService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListProjectsQueryDto): ProjectView[] {
    return this.projects.list(user.id, {
      search: query.search?.trim() || undefined,
      category: query.category,
      scope: query.scope ?? "active",
      starredOnly: query.starred === "true",
      sort: query.sort ?? "updated",
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto): ProjectView {
    return this.projects.create(user.id, dto.category, dto.name);
  }

  @Get(":projectId")
  @ApiNotFoundResponse({ description: "Project not found for this user." })
  get(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string): ProjectView {
    return this.projects.get(user.id, projectId);
  }

  @Patch(":projectId")
  update(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ): ProjectView {
    return this.projects.update(user.id, projectId, dto);
  }

  @Post(":projectId/duplicate")
  duplicate(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string): ProjectView {
    return this.projects.duplicate(user.id, projectId);
  }

  @Get(":projectId/measurements")
  measurements(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string) {
    return this.projects.measurements(user.id, projectId);
  }

  @Patch(":projectId/measurements")
  saveMeasurements(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Body() input: unknown,
  ) {
    return this.projects.saveMeasurements(user.id, projectId, input);
  }

  @Delete(":projectId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string): void {
    this.projects.remove(user.id, projectId);
  }

  /** The scene's history in order: applied command batches and imported models. The editor replays it. */
  @Get(":projectId/scene")
  scene(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
  ): { steps: SceneStep[]; recoveryRequired: boolean } {
    return {
      steps: this.projects.scene(user.id, projectId),
      recoveryRequired: this.projects.recoveryRequired(user.id, projectId),
    };
  }

  /** Records moves, rotations and scale changes the user made by hand. */
  @Post(":projectId/scene/history/preview")
  previewHistory(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Body() dto: SceneHistoryDto,
  ) {
    return this.projects.previewHistory(user.id, projectId, dto.direction);
  }

  @Post(":projectId/scene/history/commit")
  commitHistory(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Body() dto: CommitSceneHistoryDto,
  ) {
    this.projects.commitHistory(user.id, projectId, dto.direction, dto.version, dto.operationId);
    return { committed: true };
  }

  @Post(":projectId/scene/edits")
  recordSceneEdit(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Body() dto: RecordSceneEditDto,
  ): { proposalId: string } {
    return this.projects.recordSceneEdit(user.id, projectId, dto.commands, dto.actionId);
  }

  @Post(":projectId/scene/script")
  generateScript(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string, @Body() input: unknown) {
    this.projects.get(user.id, projectId);
    return this.scripts.generate(projectId, input);
  }

  /** Imports a model: the file is the request body (application/octet-stream), described by the query. */
  @Post(":projectId/assets")
  importModel(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Query() query: ImportModelQueryDto,
    @Body() body: unknown,
  ): SceneImport {
    if (!Buffer.isBuffer(body)) throw new ValidationFailedError("Send the model file as application/octet-stream");
    return this.projects.importModel(user.id, projectId, {
      name: query.name,
      format: query.format,
      objectId: query.objectId,
      content: body,
    });
  }

  @Get(":projectId/assets/:assetId")
  model(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
    @Param("assetId", assetIdPipe) assetId: string,
  ): StreamableFile {
    const asset = this.projects.model(user.id, projectId, assetId);
    return new StreamableFile(asset.content, { type: "application/octet-stream" });
  }

  /** Clears saved chat sessions without removing the scene or its history. */
  @Delete(":projectId/conversation")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearConversation(@CurrentUser() user: AuthUser, @Param("projectId", projectIdPipe) projectId: string): void {
    this.projects.clearConversation(user.id, projectId);
  }

  /** The latest chat, so the assistant can continue where it stopped. */
  @Get(":projectId/conversation")
  conversation(
    @CurrentUser() user: AuthUser,
    @Param("projectId", projectIdPipe) projectId: string,
  ): ProjectConversation {
    return this.projects.conversation(user.id, projectId);
  }
}
