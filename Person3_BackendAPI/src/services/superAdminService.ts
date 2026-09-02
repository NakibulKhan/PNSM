import { AuditLogEntry, Role, SpoofAlert, User } from '../models';
import { getSingletonBilling } from '../models/Billing';
import { getSingletonPolicy } from '../models/Policy';
import type { UpdatePolicyInput } from '../validation/policySchemas';
import { toRoleKey } from '../constants';

export async function listAdmins() {
  const adminRoleNames = ['Super Admin', 'Admin'];
  const roleIds = await Role.find({ role_name: { $in: adminRoleNames } }).select('_id role_name').lean();
  const roleNameById = new Map(roleIds.map((r) => [String(r._id), r.role_name]));

  const admins = await User.find({ role_id: { $in: roleIds.map((r) => r._id) } })
    .select('name email is_active role_id created_at')
    .lean();

  return admins.map((a) => ({
    _id: String(a._id),
    name: a.name,
    email: a.email,
    is_active: a.is_active,
    role: toRoleKey(roleNameById.get(String(a.role_id)) ?? 'Admin'),
    created_at: a.created_at,
  }));
}

export async function listAuditLog(page = 1, pageSize = 50) {
  const skip = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    AuditLogEntry.find({}).sort({ created_at: -1 }).skip(skip).limit(pageSize).populate('actor_id', 'name').lean(),
    AuditLogEntry.countDocuments({}),
  ]);
  return {
    rows: rows.map((r) => {
      const actor = r.actor_id as unknown as { _id?: unknown; name?: string } | null;
      return {
        _id: String(r._id),
        actor_id: actor?._id ? String(actor._id) : String(r.actor_id),
        actor_name: actor?.name,
        action: r.action,
        target: r.target,
        created_at: r.created_at,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function recordAuditEntry(actorId: string, action: string, target: string): Promise<void> {
  await AuditLogEntry.create({ actor_id: actorId, action, target });
}

export async function listSpoofAlerts(page = 1, pageSize = 50) {
  const skip = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    SpoofAlert.find({}).sort({ detected_at: -1 }).skip(skip).limit(pageSize).populate('user_id', 'name').lean(),
    SpoofAlert.countDocuments({}),
  ]);
  return {
    rows: rows.map((r) => {
      const user = r.user_id as unknown as { _id?: unknown; name?: string } | null;
      return {
        _id: String(r._id),
        user_id: user?._id ? String(user._id) : String(r.user_id),
        employee_name: user?.name,
        detected_at: r.detected_at,
        reason: r.reason,
        gps_location: r.gps_location,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function getBilling() {
  const billing = await getSingletonBilling();
  return {
    plan: billing.plan,
    seats: billing.seats,
    monthly_cost_bdt: billing.monthly_cost_bdt,
    renewal_date: billing.renewal_date,
    components: billing.components,
  };
}

export async function getPolicy() {
  const policy = await getSingletonPolicy();
  return {
    face_match_threshold: policy.face_match_threshold,
    default_radius_meters: policy.default_radius_meters,
    late_arrival_cutoff: policy.late_arrival_cutoff,
    block_mock_location: policy.block_mock_location,
  };
}

export async function updatePolicy(input: UpdatePolicyInput) {
  const policy = await getSingletonPolicy();
  Object.assign(policy, input);
  await policy.save();
  return getPolicy();
}
