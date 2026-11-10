import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { TaskPriority, TaskType } from '../schemas/task.schema.js';
import { MAX_SUGGESTIONS } from '../ai/ai.service.js';

export class SuggestTasksDto {
  @IsString()
  @Length(20, 4000)
  requirement: string;
}

// One reviewed suggestion. Validated again here because the user may have edited it.
export class BulkTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsMongoId()
  assignee?: string;
}

export class BulkCreateTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUGGESTIONS)
  @ValidateNested({ each: true })
  @Type(() => BulkTaskDto)
  tasks: BulkTaskDto[];
}
