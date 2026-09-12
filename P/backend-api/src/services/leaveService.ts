import { LeaveBalance, LeaveRequest, Notification } from '../models';
import type { CreateLeaveRequestInput, ListLeaveQuery } from '../validation/leaveSchemas';
import { AdminApiError } from '../utils/errors';
import { emitNotificationNew } from './socket/emitters';

function toLeaveRequestDTO(doc: {
  _id: unknown;
  user_id: { _id?: unknown; name?: string } | unknown;
  leave_type: string;
  from_date: Date;
  to_date: Date;
  reason: string;
  status: string;
  // Mongoose's schema-type inference doesn't surface `timestamps`-option
  // fields even though they exist at runtime.
  created_at?: Date;
}) {
  const user = doc.user_id as { _id?: unknown; name?: string } | null;
  return {
    _id: String(doc._id),
    user_id: user?._id ? String(user._id) : String(doc.user_id),
    employee_name: user?.name,
    leave_type: doc.leave_type,
    from_date: doc.from_date,
    to_date: doc.to_date,
    reason: doc.reason,
    status: doc.status,
    created_at: doc.created_at,
  };
}

export async function listLeaveRequests(query: ListLeaveQuery) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    LeaveRequest.find(filter).sort({ created_at: -1 }).skip(skip).limit(query.pageSize).populate('user_id', 'name').lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { rows: rows.map(toLeaveRequestDTO), total, page: query.page, pageSize: query.pageSize };
}

export async function createLeaveRequest(userId: string, input: CreateLeaveRequestInput) {
  const request = await LeaveRequest.create({
    user_id: userId,
    leave_type: input.leave_type,
    from_date: new Date(input.from_date),
    to_date: new Date(input.to_date),
    reason: input.reason,
    status: 'pending',
  });
  const populated = await LeaveRequest.findById(request._id).populate('user_id', 'name').lean();
  return toLeaveRequestDTO(populated!);
}

export async function listOwnLeaveRequests(userId: string) {
  const rows = await LeaveRequest.find({ user_id: userId }).sort({ created_at: -1 }).lean();
  return rows.map((r) => toLeaveRequestDTO({ ...r, user_id: { _id: userId } }));
}

async function setLeaveStatus(id: string, status: 'approved' | 'rejected') {
  const request = await LeaveRequest.findByIdAndUpdate(id, { status }, { new: true }).populate('user_id', 'name').lean();
  if (!request) throw new AdminApiError(404, 'NOT_FOUND', 'Leave request not found.');

  if (status === 'approved') {
    const days = Math.round((request.to_date.getTime() - request.from_date.getTime()) / 86_400_000) + 1;
    await LeaveBalance.findOneAndUpdate(
      { user_id: request.user_id, leave_type: request.leave_type },
      { $inc: { used: Math.max(days, 0) } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  const dto = toLeaveRequestDTO(request);
  const notification = await Notification.create({
    recipient_id: (request.user_id as { _id?: unknown })._id ?? request.user_id,
    message: `Your ${request.leave_type} leave request was ${status}.`,
  }).catch(() => null);
  if (notification) {
    emitNotificationNew({ _id: String(notification._id), message: notification.message, created_at: notification.created_at });
  }
  return dto;
}

export const approveLeaveRequest = (id: string) => setLeaveStatus(id, 'approved');
export const rejectLeaveRequest = (id: string) => setLeaveStatus(id, 'rejected');

export async function listLeaveBalances(userId: string) {
  const rows = await LeaveBalance.find({ user_id: userId }).lean();
  return rows.map((b) => ({ _id: String(b._id), user_id: String(b.user_id), leave_type: b.leave_type, total: b.total, used: b.used }));
}
