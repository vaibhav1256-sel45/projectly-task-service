import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class AttachmentDto {
  // the key common-service handed out for the upload
  @IsString()
  @Matches(/^attachments\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/, { message: 'Invalid attachment key' })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ATTACHMENT_BYTES)
  size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contentType?: string;
}
