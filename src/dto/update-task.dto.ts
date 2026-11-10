import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { CreateTaskDto } from './create-task.dto.js';
import { AttachmentDto } from './attachment.dto.js';
import { MAX_ATTACHMENTS } from '../schemas/task.schema.js';

// A task can't be moved to another project. Attachments are not replaced as a whole:
// files already uploaded to S3 are added, and saved ones are removed by id, together with the other changes.
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['projectId', 'attachments'] as const),
) {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  addAttachments?: AttachmentDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @IsMongoId({ each: true })
  removeAttachments?: string[];
}
