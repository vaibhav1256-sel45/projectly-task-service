import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

export enum HistoryAction {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  COMMENTED = 'COMMENTED',
  PROJECT_DELETED = 'PROJECT_DELETED',
}

// One field that changed. Assignee values are user ids; the list endpoint turns them into names.
@Schema({ _id: false })
export class HistoryChange {
  @Prop({ required: true })
  field: string;

  @Prop({ type: String, default: null })
  from: string | null;

  @Prop({ type: String, default: null })
  to: string | null;
}
export const HistoryChangeSchema = SchemaFactory.createForClass(HistoryChange);

// Append-only log of what happened to a task
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class TaskHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Task', required: true, index: true })
  taskId: Types.ObjectId;

  // who did it; null when the system did it
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, enum: HistoryAction, required: true })
  action: HistoryAction;

  @Prop({ type: [HistoryChangeSchema], default: [] })
  changes: HistoryChange[];
}

export const TaskHistorySchema = SchemaFactory.createForClass(TaskHistory);
TaskHistorySchema.index({ taskId: 1, createdAt: -1 });
