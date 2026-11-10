import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum CommentStatus {
  ACTIVE = 'ACTIVE',
  DELETED = 'DELETED',
}

@Schema({ timestamps: true })
export class Comment {
  // Reference to the task the comment belongs to
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
  taskId: Types.ObjectId;

  // Reference to the user who wrote it
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 1000 })
  content: string;

  // DELETED when the project of the task is deleted
  @Prop({ type: String, enum: CommentStatus, default: CommentStatus.ACTIVE, index: true })
  status: CommentStatus;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
