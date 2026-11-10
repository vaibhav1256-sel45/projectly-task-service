import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TaskDocument = HydratedDocument<Task>;

// Enums
export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}


export enum TaskType {
  TASK = 'TASK',
  BUG = 'BUG',
  STORY = 'STORY',
}

export const MAX_ATTACHMENTS = 10;

// A file uploaded to S3 by the browser (presigned URL); only its key and details are stored here
@Schema()
export class Attachment {
  @Prop({ required: true })
  key: string;

  @Prop({ required: true, trim: true, maxlength: 255 })
  name: string;

  @Prop({ default: 0 })
  size: number;

  @Prop({ default: '' })
  contentType: string;

  @Prop({ required: true })
  uploadedBy: string;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}
export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true, trim: true, maxlength: 150 })
  title: string;

  @Prop({ trim: true, default: '' })
  description: string;

  @Prop({ type: String, enum: TaskStatus, default: TaskStatus.TODO, index: true })
  status: TaskStatus;

  @Prop({ type: String, enum: TaskPriority, default: TaskPriority.MEDIUM, index: true })
  priority: TaskPriority;

  @Prop({ type: String, enum: TaskType, default: TaskType.TASK, index: true })
  type: TaskType;

  @Prop({ type: Date, default: null })
  dueDate?: Date;

  // Foreign key to Project
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  // User who created the task
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  // Who reported the task; the creator unless someone else is picked. Older tasks have none: use createdBy.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  reporter: Types.ObjectId | null;

  // The one assigned member, or null when the task is unassigned
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  assignee: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Comment' }] })
  comments: Types.ObjectId[];

  // embedded, at most MAX_ATTACHMENTS per task
  @Prop({ type: [AttachmentSchema], default: [] })
  attachments: Attachment[];
}

export const TaskSchema = SchemaFactory.createForClass(Task);

// Compound Indexes for fast querying
TaskSchema.index({ projectId: 1, status: 1 });
TaskSchema.index({ assignee: 1, status: 1 });