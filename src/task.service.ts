import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { MAX_ATTACHMENTS, Task, TaskPriority, TaskStatus } from "./schemas/task.schema.js";
import { AttachmentDto } from "./dto/attachment.dto.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { UpdateTaskDto } from "./dto/update-task.dto.js";
import { ListTaskQueryDto } from "./dto/list-task.dto.js";
import { GrpcBreaker } from "./grpc/grpc-breaker.service.js";
import { Comment, CommentStatus } from "./schemas/comment.schema.js";
import { HistoryAction, TaskHistory } from "./schemas/history.schema.js";
import { CreateCommentDto, ListCommentQueryDto } from "./dto/comment.dto.js";
import { BulkTaskDto } from "./dto/ai-task.dto.js";
import { AiService } from "./ai/ai.service.js";
import { ConfigService } from '@nestjs/config';
import { can, permissionError, type Permission } from './permissions.js';
import { type ClientGrpc, type ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

const STATUS_LABEL: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
const day = (value: any) => (value ? new Date(value).toISOString().slice(0, 10) : 'none');
// history fields whose values are user ids (shown as people)
const PEOPLE_FIELDS = ['assignee', 'reporter'];

// the assignee as a string id, '' when the task is unassigned
const idOf = (value: any) => String(value ?? '');
@Injectable()
export class TaskService implements OnModuleInit {
private userService:any
private projectService:any
private readonly logger = new Logger(TaskService.name);
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(TaskHistory.name) private readonly historyModel: Model<TaskHistory>,
    @Inject('USER') private readonly client:ClientGrpc,
    @Inject('PROJECT') private readonly projectClient: ClientGrpc,
    @Inject('MAIL') private readonly mailClient: ClientProxy,
    private readonly configService: ConfigService,
    private readonly grpc: GrpcBreaker,
    private readonly ai: AiService,
  ) {}


onModuleInit() {
    this.userService=this.client.getService('UserService')
    this.projectService=this.projectClient.getService('ProjectService')
}

  // Only the project owner or a member is allowed; the assignee must be one of them too
  private async checkAccess(projectId: string, userId: string, assigneeId?: string | null, permission: Permission = 'view') {
    const project: any = await this.grpc.call('project.getMembersId', () =>
      this.projectService.getMembersId({ project_id: String(projectId) }),
    );
    const { owner_id, member_ids, member_roles } = project;

    if (userId !== owner_id && !member_ids.includes(userId)) {
      throw new ForbiddenException("Only the project owner or a member can do this");
    }
    const role = userId === owner_id ? 'OWNER' : member_roles?.[userId] ?? 'EDITOR';
    if (!can(role, permission)) {
      throw new ForbiddenException(permissionError(permission));
    }
    if (assigneeId && assigneeId !== owner_id && !member_ids.includes(assigneeId)) {
      throw new BadRequestException("Assignee must be either the project owner or a member of the project");
    }
    return { owner_id, member_ids: member_ids ?? [], role } as { owner_id: string; member_ids: string[]; role: string };
  }

  // The reporter, like the assignee, has to be the project owner or a member
  private checkReporter(access: { owner_id: string; member_ids: string[] }, reporterId?: string | null) {
    if (reporterId === null) {
      throw new BadRequestException("A task always has a reporter");
    }
    if (reporterId && reporterId !== access.owner_id && !access.member_ids.includes(reporterId)) {
      throw new BadRequestException("Reporter must be either the project owner or a member of the project");
    }
  }


  private async getUsers(ids: string[]) {
    const response: any = await this.grpc.call('user.getUsersByIds', () => this.userService.getUsersByIds({ ids }));
    return response?.users ?? [];
  }

  private taskUrl(projectId: any) {
    return `${this.configService.get('frontendUrl')}/tasks/${projectId}/board`;
  }

  // Appends to the task history. A failure here is only logged: it must never fail the request.
  private async recordHistory(entries: { taskId: any; actorId: string | null; action: HistoryAction; changes?: { field: string; from: string | null; to: string | null }[] }[]) {
    if (entries.length === 0) return;
    try {
      await this.historyModel.insertMany(entries.map((e) => ({ ...e, changes: e.changes ?? [] })));
    } catch (error) {
      this.logger.error(`could not record task history: ${(error as Error).message}`);
    }
  }

  // The fields of a task that really changed, as { field, from, to }
  private diffTask(before: any, changes: any) {
    const out: { field: string; from: string | null; to: string | null }[] = [];
    if (changes.title !== undefined && changes.title !== before.title) out.push({ field: 'title', from: before.title, to: changes.title });
    if (changes.status && changes.status !== before.status) out.push({ field: 'status', from: before.status, to: changes.status });
    if (changes.priority && changes.priority !== before.priority) out.push({ field: 'priority', from: before.priority, to: changes.priority });
    if (changes.type && changes.type !== (before.type ?? 'TASK')) out.push({ field: 'type', from: before.type ?? 'TASK', to: changes.type });
    const reporterNow = idOf(before.reporter ?? before.createdBy);
    if (changes.reporter && String(changes.reporter) !== reporterNow) out.push({ field: 'reporter', from: reporterNow || null, to: String(changes.reporter) });
    if (changes.dueDate !== undefined && day(changes.dueDate) !== day(before.dueDate)) {
      out.push({ field: 'dueDate', from: before.dueDate ? day(before.dueDate) : null, to: changes.dueDate ? day(changes.dueDate) : null });
    }
    if (changes.description !== undefined && changes.description !== before.description) {
      out.push({ field: 'description', from: before.description || null, to: changes.description || null });
    }
    const current = idOf(before.assignee);
    const next = changes.assignee === undefined ? current : String(changes.assignee ?? '');
    if (next !== current) out.push({ field: 'assignee', from: current || null, to: next || null });
    return out;
  }

  // The email itself is sent by common-service. Mail problems are only logged: they never fail the request.
  private async publishMail(event: string, payloads: object[]) {
    try {
      for (const payload of payloads) {
        await lastValueFrom(this.mailClient.emit(event, payload), { defaultValue: undefined });
      }
    } catch (error) {
      this.logger.error(`could not publish ${event}: ${(error as Error).message}`);
    }
  }

  // Tells the assignee what changed, unless they made the change themselves
  private async mailAssignee(task: any, assigneeId: string, actor: { id: string; name: string }, changes: string[]) {
    if (!assigneeId || assigneeId === actor.id || changes.length === 0) return;
    try {
      const [user] = await this.getUsers([assigneeId]);
      if (!user) return;
      await this.publishMail('mail.task-updated', [
        { email: user.email, name: user.name, taskTitle: task.title, updatedBy: actor.name, changes, appUrl: this.taskUrl(task.projectId) },
      ]);
    } catch (error) {
      this.logger.error(`could not email the assignee: ${(error as Error).message}`);
    }
  }

  // Emails the people @mentioned in a description or comment. Only project members count, and never the author.
  private async mailMentioned(
    task: any, mentions: string[] | undefined, access: { owner_id: string; member_ids: string[] },
    actor: { id: string; name: string }, where: 'description' | 'comment', text: string,
  ) {
    const ids = [...new Set(mentions ?? [])].filter(
      (id) => id !== actor.id && (id === access.owner_id || access.member_ids.includes(id)),
    );
    if (ids.length === 0) return;
    try {
      const users = await this.getUsers(ids);
      await this.publishMail('mail.task-mention', users.map((u: any) => (
        { email: u.email, name: u.name, taskTitle: task.title, mentionedBy: actor.name, where, excerpt: text, appUrl: this.taskUrl(task.projectId) }
      )));
    } catch (error) {
      this.logger.error(`could not email the mentioned users: ${(error as Error).message}`);
    }
  }

  async create(payload: CreateTaskDto, userId: string, userName: string) {
    if (payload.status === TaskStatus.CANCELLED) {
      throw new BadRequestException("A new task cannot be created as cancelled");
    }
    const access = await this.checkAccess(payload.projectId, userId, payload.assignee, 'edit');
    this.checkReporter(access, payload.reporter);

    const { assignee, reporter, mentions, attachments, ...rest } = payload;
    const task = await this.taskModel.create({
      ...rest,
      createdBy: userId,
      reporter: reporter ?? userId,
      assignee: assignee,
      attachments: (attachments ?? []).map((a) => ({ ...a, uploadedBy: userId, uploadedAt: new Date() })),
    });

    await this.recordHistory([{
      taskId: task._id, actorId: userId, action: HistoryAction.CREATED,
      changes: task.attachments.map((a) => ({ field: 'attachment', from: null, to: a.name })),
    }]);

    const actor = { id: userId, name: userName };
    await this.mailAssignee(task, assignee ?? '', actor, ['You were assigned this task']);
    await this.mailAssignee(task, reporter ?? userId, actor, ['You were set as the reporter of this task']);
    if (task.description) await this.mailMentioned(task, mentions, access, actor, 'description', task.description);

    return {
      message: "Task created successfully",
      data: task,
    };
  }


  async suggestTasks(projectId: string, requirement: string, userId: string) {
    if (!Types.ObjectId.isValid(projectId)) throw new BadRequestException("Invalid project id");
    await this.checkAccess(projectId, userId, null, 'edit');
    const existing = await this.taskModel
      .find({ projectId, status: { $ne: TaskStatus.CANCELLED } })
      .sort({ createdAt: -1 }).limit(50).select('title').lean();
    const suggestions = await this.ai.suggestTasks({ requirement, existingTitles: existing.map((t) => t.title) });
    return { message: 'Suggestions generated', data: { suggestions } };
  }

  async createMany(projectId: string, tasks: BulkTaskDto[], userId: string, userName: string) {
    if (!Types.ObjectId.isValid(projectId)) throw new BadRequestException("Invalid project id");
    const access = await this.checkAccess(projectId, userId, null, 'edit');
    for (const t of tasks) {
      if (t.assignee && t.assignee !== access.owner_id && !access.member_ids.includes(t.assignee)) {
        throw new BadRequestException("Assignee must be either the project owner or a member of the project");
      }
    }

    const created = await this.taskModel.insertMany(
      tasks.map((t) => ({ ...t, projectId, createdBy: userId, reporter: userId })),
    );
    await this.recordHistory(created.map((t) => ({ taskId: t._id, actorId: userId, action: HistoryAction.CREATED })));

    const actor = { id: userId, name: userName };
    for (const t of created) {
      if (t.assignee) await this.mailAssignee(t, String(t.assignee), actor, ['You were assigned this task']);
    }

    return {
      message: `${created.length} ${created.length === 1 ? 'task' : 'tasks'} created`,
      data: created,
    };
  }

  // Called when a project is deleted: its tasks become CANCELLED and its comments DELETED.
  // Safe to run more than once, so a redelivered message does no harm.
  async cancelProjectTasks(projectId: string) {
    if (!Types.ObjectId.isValid(projectId)) {
      return;
    }
    const taskIds = await this.taskModel.find({ projectId }).distinct('_id');
    const toCancel = await this.taskModel.find({ projectId, status: { $ne: TaskStatus.CANCELLED } }, { status: 1 }).lean();

    const tasks = await this.taskModel.updateMany(
      { projectId, status: { $ne: TaskStatus.CANCELLED } },
      { $set: { status: TaskStatus.CANCELLED } },
    );
    await this.recordHistory(toCancel.map((t) => ({
      taskId: t._id, actorId: null, action: HistoryAction.PROJECT_DELETED,
      changes: [{ field: 'status', from: t.status, to: TaskStatus.CANCELLED }],
    })));
    const comments = await this.commentModel.updateMany(
      { taskId: { $in: taskIds }, status: { $ne: CommentStatus.DELETED } },
      { $set: { status: CommentStatus.DELETED } },
    );
  }

  // Finds the task and makes sure the user belongs to its project
  private async getTaskForUser(taskId: string, userId: string, permission: Permission = 'view') {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new BadRequestException("Invalid task id");
    }
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    const access = await this.checkAccess(String(task.projectId), userId, undefined, permission);
    return { task, access };
  }

  async addComment(taskId: string, payload: CreateCommentDto, userId: string, userName: string) {
    const { task, access } = await this.getTaskForUser(taskId, userId);
    if (!can(access.role, 'edit') && String(task.createdBy) !== userId) {
      throw new ForbiddenException(permissionError('edit'));
    }
    const comment = await this.commentModel.create({
      taskId,
      createdBy: userId,
      content: payload.content,
    });

    await this.recordHistory([{ taskId: task._id, actorId: userId, action: HistoryAction.COMMENTED, changes: [{ field: 'comment', from: null, to: payload.content }] }]);
    await this.mailMentioned(task, payload.mentions, access, { id: userId, name: userName }, 'comment', payload.content);

    return {
      message: "Comment added successfully",
      data: comment,
    };
  }

  async listComments(taskId: string, query: ListCommentQueryDto, userId: string) {
    await this.getTaskForUser(taskId, userId);

    const page = Math.max(Number(query.pageNo) || 1, 1);
    const limit = Math.max(Number(query.limit) || 10, 1);

    const [comments, total] = await Promise.all([
      this.commentModel
        .find({ taskId, status: { $ne: CommentStatus.DELETED } })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.commentModel.countDocuments({ taskId, status: { $ne: CommentStatus.DELETED } }),
    ]);

    // Authors live in user-service
    let users: any[] = [];
    const ids = [...new Set(comments.map((c) => String(c.createdBy)))];
    if (ids.length) {
        const response: any = await this.grpc.call('user.getUsersByIds', () => this.userService.getUsersByIds({ ids }));
        users = response?.users ?? [];
    }
    const usersById = new Map(users.map((u: any) => [String(u.id ?? u._id), u]));

    return {
      message: "Comments fetched successfully",
      data: comments.map((c) => ({
        ...c,
        createdBy: usersById.get(String(c.createdBy)) ?? { _id: String(c.createdBy) },
      })),
      meta: { pageNo: page, limit, totalDocuments: total },
    };
  }

  // After a task was updated: tell the assignee what changed (if someone else did it), and email new @mentions
  private async mailAboutUpdate(before: any, after: any, changes: any, mentions: string[] | undefined, access: { owner_id: string; member_ids: string[] }, actor: { id: string; name: string }, fileLines: string[] = []) {
    const lines: string[] = [...fileLines];
    if (changes.title !== undefined && changes.title !== before.title) lines.push(`Title: "${changes.title}"`);
    if (changes.status && changes.status !== before.status) lines.push(`Status: ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[changes.status]}`);
    if (changes.priority && changes.priority !== before.priority) lines.push(`Priority: ${PRIORITY_LABEL[before.priority]} → ${PRIORITY_LABEL[changes.priority]}`);
    if (changes.dueDate !== undefined && day(changes.dueDate) !== day(before.dueDate)) lines.push(`Due date: ${day(before.dueDate)} → ${day(changes.dueDate)}`);
    if (changes.description !== undefined && changes.description !== before.description) lines.push('The description was updated');

    // the assignee after this update; a newly chosen assignee is told they were assigned
    const current = idOf(before.assignee);
    const currentReporter=idOf(before.reporter);
    const next = changes.assignee === undefined ? current : String(changes.assignee ?? '');
    const nextReporter = changes.reporter=== undefined ? currentReporter : String(changes.reporter ?? '');
    if (next && next !== current) lines.unshift('You were assigned this task');
    if(nextReporter && nextReporter !== currentReporter) lines.unshift('You were set as the reporter of this task');
    await this.mailAssignee(after, next, actor, lines);
    await this.mailAssignee(after, nextReporter, actor, lines);
    if (changes.description) await this.mailMentioned(after, mentions, access, actor, 'description', changes.description);
  }

  // Numbers for the project dashboard. Counts open tasks (not completed / cancelled) for priority, assignee and dates.
  async getStatistics(projectId: string) {
    const OPEN = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today.getTime() + 7 * 86400000);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const open = { status: { $in: OPEN } };

    // projectId is stored as text, but match an ObjectId too in case an older task was saved that way
    const [result] = await this.taskModel.aggregate([
      { $match: { projectId: { $in: [projectId, new Types.ObjectId(projectId)] } } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byPriority: [{ $match: open }, { $group: { _id: '$priority', count: { $sum: 1 } } }],
          byAssignee: [{ $match: open }, { $group: { _id: '$assignee', count: { $sum: 1 } } }],
          overdue: [{ $match: { ...open, dueDate: { $lt: today } } }, { $count: 'n' }],
          dueSoon: [{ $match: { ...open, dueDate: { $gte: today, $lt: week } } }, { $count: 'n' }],
          doneRecently: [{ $match: { status: TaskStatus.COMPLETED, updatedAt: { $gte: weekAgo } } }, { $count: 'n' }],
        },
      },
    ]);

    const statusCount = new Map<string, number>(result.byStatus.map((r: any) => [r._id, r.count]));
    const by_status = Object.values(TaskStatus).map((st) => ({ status: st, count: statusCount.get(st) ?? 0 }));
    const total = by_status.reduce((sum, r) => sum + r.count, 0);
    const completed = statusCount.get(TaskStatus.COMPLETED) ?? 0;
    const counted = total - (statusCount.get(TaskStatus.CANCELLED) ?? 0);

    const priorityCount = new Map<string, number>(result.byPriority.map((r: any) => [r._id, r.count]));
    const by_priority = Object.values(TaskPriority).map((p) => ({ priority: p, count: priorityCount.get(p) ?? 0 }));

    const assigned = result.byAssignee.filter((r: any) => r._id);
    const by_assignee = assigned
      .map((r: any) => ({ user_id: String(r._id), count: r.count }))
      .sort((a: any, b: any) => b.count - a.count);
    const unassigned = result.byAssignee.filter((r: any) => !r._id).reduce((sum: number, r: any) => sum + r.count, 0);

    return {
      total,
      by_status,
      by_priority,
      by_assignee,
      unassigned,
      overdue: result.overdue[0]?.n ?? 0,
      due_soon: result.dueSoon[0]?.n ?? 0,
      completed_last_7_days: result.doneRecently[0]?.n ?? 0,
      completion_rate: counted ? Math.round((completed / counted) * 1000) / 10 : 0,
    };
  }

  async listHistory(taskId: string, query: ListCommentQueryDto, userId: string) {
    await this.getTaskForUser(taskId, userId);

    const page = Math.max(Number(query.pageNo) || 1, 1);
    const limit = Math.max(Number(query.limit) || 10, 1);
    const filter = { taskId };

    const [entries, total] = await Promise.all([
      this.historyModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.historyModel.countDocuments(filter),
    ]);

    // actors and the people named in assignee changes live in user-service
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.actorId) ids.add(String(entry.actorId));
      for (const change of entry.changes) {
        if (PEOPLE_FIELDS.includes(change.field)) [change.from, change.to].forEach((v) => v && ids.add(v));
      }
    }
    let users: any[] = [];
    if (ids.size) {
      try {
        users = await this.getUsers([...ids]);
      } catch (error) {
        this.logger.error(`could not resolve users for the history: ${(error as Error).message}`);
      }
    }
    const usersById = new Map(users.map((u: any) => [String(u.id ?? u._id), u]));
    const person = (id: string | null) => (id ? usersById.get(id) ?? { _id: id } : null);

    return {
      message: 'History fetched successfully',
      data: entries.map((entry) => ({
        ...entry,
        actor: person(entry.actorId ? String(entry.actorId) : null),
        changes: entry.changes.map((c) =>
          PEOPLE_FIELDS.includes(c.field) ? { ...c, from: person(c.from), to: person(c.to) } : c),
      })),
      meta: { pageNo: page, limit, totalDocuments: total },
    };
  }

  async update(id: string, payload: UpdateTaskDto, userId: string, userName: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException("Invalid task id");
    }
    const task = await this.taskModel.findById(id).exec();
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const access = await this.checkAccess(String(task.projectId), userId, payload.assignee);
    this.checkReporter(access, payload.reporter);

    // Cancelling a task and taking files off it are the "delete" actions; every other change is an "edit".
    // What someone created is theirs, whatever their role: their task with its files, and the files they added.
    const { status: newStatus, removeAttachments: filesToRemove, mentions: _mentions, ...edits } = payload;
    const cancelling = newStatus === TaskStatus.CANCELLED;
    const editing = Object.values(edits).some((v) => v !== undefined) || (newStatus !== undefined && !cancelling);
    const ownsTask = String(task.createdBy) === userId;
    const ownsFiles = (task.attachments as any[])
      .filter((f) => filesToRemove?.includes(String(f._id)))
      .every((f) => String(f.uploadedBy) === userId);
    if (editing && !can(access.role, 'edit') && !ownsTask) {
      throw new ForbiddenException(permissionError('edit'));
    }
    if (cancelling && !can(access.role, 'delete') && !ownsTask) {
      throw new ForbiddenException('You can only cancel tasks you created');
    }
    if (filesToRemove?.length && !can(access.role, 'delete') && !ownsTask && !ownsFiles) {
      throw new ForbiddenException('You can only remove files you added');
    }

    if (task.status === TaskStatus.CANCELLED) {
      throw new ConflictException("This task is cancelled and can no longer be updated");
    }

    // `mentions` only says who to email; the two attachment lists are folded into the new `attachments` value
    const { mentions, addAttachments = [], removeAttachments = [], ...changes } = payload;

    const files = task.toObject().attachments;
    const removed = files.filter((f: any) => removeAttachments.includes(String(f._id)));
    const attachments = [
      ...files.filter((f: any) => !removed.includes(f)),
      ...addAttachments.map((f) => ({ ...f, uploadedBy: userId, uploadedAt: new Date() })),
    ];
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`A task can have at most ${MAX_ATTACHMENTS} attachments`);
    }
    const set: any = { ...changes };
    if (removed.length || addAttachments.length) set.attachments = attachments;

    // The status condition is part of the write itself, so a cancelled task can
    // never be modified, even if it was cancelled a moment ago by someone else.
    const updatedTask = await this.taskModel
      .findOneAndUpdate(
        { _id: id, status: { $ne: TaskStatus.CANCELLED } },
        { $set: set },
        { new: true, runValidators: true },
      )
      .exec();

    if (updatedTask) {
      const diff = [
        ...this.diffTask(task, changes),
        ...removed.map((f: any) => ({ field: 'attachment', from: f.name as string, to: null })),
        ...addAttachments.map((a) => ({ field: 'attachment', from: null, to: a.name })),
      ];
      if (diff.length) await this.recordHistory([{ taskId: task._id, actorId: userId, action: HistoryAction.UPDATED, changes: diff }]);
      const fileLines = [
        ...addAttachments.map((f) => `Attachment added: ${f.name}`),
        ...removed.map((f: any) => `Attachment removed: ${f.name}`),
      ];
      await this.mailAboutUpdate(task, updatedTask, changes, mentions, access, { id: userId, name: userName }, fileLines);
      return {
        message: "Task updated successfully",
        data: updatedTask,
      };
    }

    // Nothing matched: find out why so the caller gets an accurate message.
    const existing = await this.taskModel.exists({ _id: id });
    if (!existing) {
      throw new NotFoundException("Task not found");
    }
    throw new ConflictException("This task is cancelled and can no longer be updated");
  }

 async list(query: ListTaskQueryDto, userId: string) {
  const { status, searchKey, pageNo, limit, priority, projectId, assigneeId, assignee } = query;
  
  const access = await this.checkAccess(projectId, userId, assigneeId);
  const filters: any = {};

  if (projectId) {
    filters.projectId = projectId;
  }
  if (assigneeId) {
    filters.assignee = assigneeId;
  }
  if (status) {
    filters.status = status;
  }
  if (priority) {
    filters.priority = priority;
  }
  if (searchKey) {
    const pattern = new RegExp(
      searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    filters.$or = [{ title: pattern }, { description: pattern }];
  }

  if (assignee) {
    const parts = assignee.split(',');
    const ids = parts.filter((p) => p.toLowerCase() !== 'unassigned');
    const anyOf: any[] = [];
    if (ids.length) anyOf.push({ assignee: { $in: ids } });
    if (ids.length !== parts.length) {
      anyOf.push({ assignee: null }); // unassigned (null or missing)
    }
    filters.$and = [...(filters.$and ?? []), { $or: anyOf }];
  }

  const page = Math.max(Number(pageNo), 1);
  const lmt = Math.max(Number(limit) || 10, 1);
  const skip = (page - 1) * lmt;

  // 1. Fetch tasks and count
  const [tasks, total] = await Promise.all([
    this.taskModel
      .find(filters)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(lmt)
      .lean(),
    this.taskModel.countDocuments(filters),
  ]);

  const assigneeOf = (task: any): string | null => (task.assignee ? String(task.assignee) : null);

  const reporterOf = (task: any): string => String(task.reporter ?? task.createdBy);

  // 2. Collect the unique people: assignees and reporters
  const assigneeIds = [
    ...new Set(
      [...tasks.map(assigneeOf), ...tasks.map(reporterOf)].filter((id): id is string => Boolean(id)),
    ),
  ];

  // 3. Resolve them through user-service; the board still works if it is down
  let users: any[] = [];
  if (assigneeIds.length > 0 && this.userService) {
  
      const response: any = await this.grpc.call('user.getUsersByIds', () =>
        this.userService.getUsersByIds({ ids: assigneeIds }),
      );
      users = response?.users ?? (Array.isArray(response) ? response : []);
  
  }
  const usersById = new Map(
    users.map((user: any) => [String(user.id ?? user._id), user]),
  );

  // 4. Populate the single assignee; keep the id when the user can't be resolved
  const populatedTasks = tasks.map((task) => {
    const id = assigneeOf(task);
    return {
      ...task,
      assignee: id ? usersById.get(id) ?? { _id: id } : null,
      // same access as in the project, except that whoever created the task is an admin of it
      myRole: String(task.createdBy) === userId || access.role === 'OWNER' ? 'ADMIN' : access.role,
      reporter: usersById.get(reporterOf(task)) ?? { _id: reporterOf(task) },
      type: task.type ?? 'TASK',
    };
  });

  return {
    message: 'Tasks fetched successfully',
    data: populatedTasks,
    meta: {
      pageNo: page,
      limit: lmt,
      totalDocuments: total,
    },
  };
}

}


