import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { TaskService } from './task.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { ListTaskQueryDto } from './dto/list-task.dto.js';
import { CreateCommentDto, ListCommentQueryDto } from './dto/comment.dto.js';
import { BulkCreateTasksDto, SuggestTasksDto } from './dto/ai-task.dto.js';
import { Ctx, EventPattern, GrpcMethod, Payload, RmqContext, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Types } from 'mongoose';
import { CurrentUser } from './decorators/current-user.decorator.js';

@ApiTags('Tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new task',
    description: 'Creates a task with details like title, description, project, assignee, and priority.',
  })
  @ApiBody({ type: CreateTaskDto })
  @ApiResponse({
    status: 210, // or 201 Created
    description: 'Task created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation error in request body',
  })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can create tasks' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async create(@Body() payload: CreateTaskDto,@CurrentUser('id') userId:string,@CurrentUser('name') userName:string) {
    return this.taskService.create(payload, userId, userName);
  }

  @Post('projects/:projectId/suggestions')
  @ApiOperation({
    summary: 'Suggest tasks for a feature (AI)',
    description: 'Sends the feature requirement to the LLM and returns validated task suggestions. Nothing is saved.',
  })
  @ApiBody({ type: SuggestTasksDto })
  @ApiResponse({ status: 403, description: 'Only editors and admins can generate tasks' })
  @ApiResponse({ status: 429, description: 'The LLM rate limit was reached' })
  @ApiResponse({ status: 502, description: 'The LLM failed or answered in the wrong shape' })
  @ApiResponse({ status: 503, description: 'GROQ_API_KEY is not set' })
  async suggest(@Param('projectId') projectId: string, @Body() payload: SuggestTasksDto, @CurrentUser('id') userId: string) {
    return this.taskService.suggestTasks(projectId, payload.requirement, userId);
  }

  @Post('projects/:projectId/bulk')
  @ApiOperation({
    summary: 'Create several tasks at once',
    description: 'Saves the AI suggestions the user reviewed (1-15 tasks), each as a To Do task.',
  })
  @ApiBody({ type: BulkCreateTasksDto })
  @ApiResponse({ status: 403, description: 'Only editors and admins can create tasks' })
  async createMany(
    @Param('projectId') projectId: string,
    @Body() payload: BulkCreateTasksDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('name') userName: string,
  ) {
    return this.taskService.createMany(projectId, payload.tasks, userId, userName);
  }

  @Get()
  @ApiOperation({
    summary: 'List and filter tasks',
    description: 'Retrieve a paginated list of tasks filtered by status, priority, or search keyword.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of tasks retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can view tasks' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async list(@Query() query: ListTaskQueryDto, @CurrentUser('id') userId: string) {
    return this.taskService.list(query, userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update task by ID',
    description: 'Update one or more fields of an existing task.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId of the task to update',
    example: '6702e8a1f82b1d3a9c4e1234',
  })
  @ApiBody({ type: UpdateTaskDto })
  @ApiResponse({
    status: 200,
    description: 'Task updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid task id or validation error',
  })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can update tasks' })
  @ApiResponse({
    status: 404,
    description: 'Task or project not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Task is cancelled and can no longer be updated',
  })
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('name') userName: string,
  ) {
    return this.taskService.update(id, payload, userId, userName);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the task' })
  @ApiResponse({ status: 201, description: 'Comment added successfully' })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can comment' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async addComment(
    @Param('id') id: string,
    @Body() payload: CreateCommentDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('name') userName: string,
  ) {
    return this.taskService.addComment(id, payload, userId, userName);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'List comments of a task', description: 'Newest first, paginated.' })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the task' })
  @ApiResponse({ status: 200, description: 'Comments fetched successfully' })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can view comments' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async listComments(
    @Param('id') id: string,
    @Query() query: ListCommentQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.listComments(id, query, userId);
  }




  @Get(':id/history')
  @ApiOperation({ summary: 'History of a task', description: 'Who changed what and when. Newest first, paginated.' })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the task' })
  @ApiResponse({ status: 200, description: 'History fetched successfully' })
  @ApiResponse({ status: 403, description: 'Only the project owner or a member can view the history' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async listHistory(
    @Param('id') id: string,
    @Query() query: ListCommentQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.listHistory(id, query, userId);
  }

  // RabbitMQ event from project-service when a project is deleted
  @EventPattern('project.deleted')
  async onProjectDeleted(@Payload() data: { projectId: string }, @Ctx() context: any) {
    const rmq = context as RmqContext;
    const channel = rmq.getChannelRef();
    const message = rmq.getMessage();
    try {
      await this.taskService.cancelProjectTasks(data.projectId);
      channel.ack(message);
    } catch (error) {
      // put the message back so it is tried again
      channel.nack(message, false, true);
    }
  }

  // Called by project-service over gRPC (dashboard numbers). The AuthGuard lets non-HTTP calls through,
  // and project-service checks that the user belongs to the project before asking.
  @GrpcMethod('TaskService', 'getTaskStatistics')
  async getTaskStatistics(data: { project_id?: string }) {
    if (!data.project_id || !Types.ObjectId.isValid(data.project_id)) {
      throw new RpcException({ code: status.INVALID_ARGUMENT, message: 'project_id is missing or invalid' });
    }
    return this.taskService.getStatistics(data.project_id);
  }
}
