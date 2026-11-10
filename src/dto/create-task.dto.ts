import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttachmentDto } from './attachment.dto.js';
import { MAX_ATTACHMENTS, TaskPriority, TaskStatus, TaskType } from '../schemas/task.schema.js';


export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsOptional()
  @IsString()
  @IsMongoId()
  assignee?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  // defaults to the person creating the task
  @IsOptional()
  @IsString()
  @IsMongoId()
  reporter?: string;

  // ids of the people @mentioned in the description; they get an email
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  mentions?: string[];

  // files already uploaded to S3 by the browser
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
