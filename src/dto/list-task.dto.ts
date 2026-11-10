import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TaskPriority, TaskStatus } from '../schemas/task.schema.js';

export class ListTaskQueryDto {
  // required: without it the query would return tasks from every project
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsOptional()
  @IsMongoId()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  searchKey?: string;

  // Comma-separated user ids and/or the word "unassigned", e.g. "665f...,unassigned"
  @IsOptional()
  @Matches(/^(unassigned|[a-f0-9]{24})(,(unassigned|[a-f0-9]{24}))*$/i, {
    message: 'assignee must be a comma-separated list of user ids or "unassigned"',
  })
  assignee?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}