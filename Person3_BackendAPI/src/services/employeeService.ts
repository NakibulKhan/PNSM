/**
 * Employee CRUD + onboarding (01-API-CONTRACT.md's Employees section).
 * PIN hashing and face-embedding generation are Person 4's (DECISIONS.md N1)
 * — this service generates the plaintext PIN locally (still Person 3's job;
 * only the hashing moved) and hands it to Person 4's client to hash/embed.
 */
import { Types } from 'mongoose';
import { AttendanceLog, FaceEmbedding, Office, Role, Shift, User } from '../models';
import type { CreateEmployeeInput, ListEmployeesQuery, UpdateEmployeeInput } from '../validation/employeeSchemas';
import { generatePin, hashPassword } from '../utils/password';
import { getAiClient, newUlid } from './aiClient';
import { parseWeekLabel } from '../utils/shiftDays';
import { AdminApiError } from '../utils/errors';
import { logger } from '../utils/logger';

async function employeeRoleId(): Promise<Types.ObjectId> {
  const role = await Role.findOne({ role_name: 'Employee' }).select('_id').lean();
  if (!role) throw new AdminApiError(500, 'INTERNAL_ERROR', 'Employee role is not seeded.');
  return role._id;
}

/** Best-effort — the reference photo is already uploaded (S3 key/URL); embedding failure shouldn't block employee creation. */
async function tryGenerateEmbedding(userId: string, referencePhotoUrl: string): Promise<void> {
  try {
    const ai = getAiClient();
    // The URL Person 2 sends is the presigned object's public form; the AI
    // service expects the bucket key it can fetch. Since Person 4 owns the
    // bucket layout, this passes the URL through as a base64/s3_key value is
    // not guaranteed to resolve — recorded as a known gap rather than guessed
    // at, since it depends on Person 4's key-naming, not documented here.
    const result = await ai.embed(userId, { kind: 's3_key', value: referencePhotoUrl }, newUlid());
    await FaceEmbedding.findOneAndUpdate(
      { user_id: userId },
      { user_id: userId, envelope: result.envelope, model_version: result.model_version },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.error('Embedding generation failed — employee created without a face embedding', err, { userId });
  }
}

async function tryIssuePin(userId: string): Promise<string> {
  const pin = generatePin();
  try {
    const ai = getAiClient();
    const result = await ai.hashPin(userId, pin);
    await User.findByIdAndUpdate(userId, {
      pin_hash: result.pin_hash,
      pin_algo: result.algo,
      pin_cost: result.cost,
      pin_pepper_version: result.pepper_version,
    });
  } catch (err) {
    logger.error('PIN hashing via AI service failed — employee has no PIN set yet', err, { userId });
  }
  return pin;
}

function toEmployeeDTO(user: {
  _id: unknown;
  name: string;
  email: string;
  role_id: unknown;
  phone: string;
  employee_code?: string | null;
  department?: string;
  office_id?: { _id?: unknown; office_name?: string } | unknown;
  is_active: boolean;
  reference_photo_url?: string | null;
  // Mongoose's automatic schema-type inference doesn't surface fields added
  // by the `timestamps` schema option, even though they exist at runtime —
  // optional here for that reason, not because the field is ever really
  // absent.
  created_at?: Date;
  has_face_embedding?: boolean;
  office_name?: string;
}) {
  const office = user.office_id as { _id?: unknown; office_name?: string } | null;
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    employee_code: user.employee_code,
    department: user.department,
    office_id: office?._id ? String(office._id) : user.office_id ? String(user.office_id) : null,
    office_name: office?.office_name ?? user.office_name,
    is_active: user.is_active,
    reference_photo_url: user.reference_photo_url,
    has_face_embedding: Boolean(user.has_face_embedding),
    created_at: user.created_at,
  };
}

export async function listEmployees(query: ListEmployeesQuery) {
  const filter: Record<string, unknown> = {};
  if (query.officeId) filter.office_id = query.officeId;
  if (query.search) {
    const rx = new RegExp(query.search.trim(), 'i');
    filter.$or = [{ name: rx }, { employee_code: rx }, { email: rx }, { department: rx }];
  }

  const skip = (query.page - 1) * query.pageSize;
  const [users, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip(skip).limit(query.pageSize).populate('office_id', 'office_name').lean(),
    User.countDocuments(filter),
  ]);

  const embeddingUserIds = new Set(
    (await FaceEmbedding.find({ user_id: { $in: users.map((u) => u._id) } }).select('user_id').lean()).map((e) =>
      String(e.user_id),
    ),
  );

  return {
    rows: users.map((u) => toEmployeeDTO({ ...u, has_face_embedding: embeddingUserIds.has(String(u._id)) })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getEmployee(id: string) {
  const user = await User.findById(id).populate('office_id', 'office_name').lean();
  if (!user) throw new AdminApiError(404, 'NOT_FOUND', 'Employee not found.');

  const [shift, recentLogs, embedding] = await Promise.all([
    Shift.findOne({ user_id: id }).lean(),
    AttendanceLog.find({ user_id: id }).sort({ timestamp: -1 }).limit(25).lean(),
    FaceEmbedding.findOne({ user_id: id }).select('model_version created_at').lean(),
  ]);

  return {
    ...toEmployeeDTO({ ...user, has_face_embedding: Boolean(embedding) }),
    shift: shift
      ? {
          _id: String(shift._id),
          start_time: shift.start_time,
          end_time: shift.end_time,
          days_of_week: shift.days_of_week,
          days_of_week_label: shift.days_of_week_label,
        }
      : null,
    recent_logs: recentLogs.map((log) => ({
      _id: String(log._id),
      check_type: log.check_type,
      timestamp: log.timestamp,
      status: log.status,
      face_match_score: log.face_match_score,
    })),
    face_embedding_meta: embedding
      ? { model_version: embedding.model_version, created_at: embedding.created_at, encrypted: true }
      : null,
  };
}

/**
 * POST /employees. Returns `{ employee, generated_pin }` — the plaintext PIN
 * is visible exactly once, per 01-API-CONTRACT.md.
 */
export async function createEmployee(input: CreateEmployeeInput) {
  const existing = await User.findOne({ $or: [{ email: input.email }, { employee_code: input.employee_code }] }).lean();
  if (existing) {
    throw new AdminApiError(409, 'DUPLICATE_EMPLOYEE', 'An employee with this email or employee code already exists.');
  }

  const office = await Office.findById(input.office_id).lean();
  if (!office) throw new AdminApiError(422, 'VALIDATION_FAILED', 'office_id does not refer to a real office.');

  const roleId = await employeeRoleId();
  // Employees authenticate with a password too (mobile login, DECISIONS.md
  // N3) — HR sets an initial one here; a real "employee sets their own
  // password on first login" flow is a Phase-3-or-later addition, not
  // documented by any quadrant yet, so this generates one rather than
  // leaving the account unable to log in at all.
  const initialPassword = generatePin() + generatePin(); // 8 random digits, HR can reset later
  const passwordHash = await hashPassword(initialPassword);

  const user = await User.create({
    name: input.name,
    email: input.email,
    password_hash: passwordHash,
    role_id: roleId,
    phone: input.phone,
    employee_code: input.employee_code,
    department: input.department,
    office_id: office._id,
    reference_photo_url: input.reference_photo_url,
  });

  await Shift.create({
    user_id: user._id,
    start_time: input.shift_start,
    end_time: input.shift_end,
    days_of_week: parseWeekLabel(input.days_of_week),
  });

  const generatedPin = await tryIssuePin(String(user._id));
  await tryGenerateEmbedding(String(user._id), input.reference_photo_url);

  const created = await User.findById(user._id).populate('office_id', 'office_name').lean();
  return { employee: toEmployeeDTO({ ...created!, has_face_embedding: true }), generated_pin: generatedPin };
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput) {
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.department !== undefined) update.department = input.department;
  if (input.office_id !== undefined) update.office_id = input.office_id;
  if (input.is_active !== undefined) update.is_active = input.is_active;

  const user = await User.findByIdAndUpdate(id, update, { new: true }).populate('office_id', 'office_name').lean();
  if (!user) throw new AdminApiError(404, 'NOT_FOUND', 'Employee not found.');

  if (input.shift_start !== undefined || input.shift_end !== undefined || input.days_of_week !== undefined) {
    const shiftUpdate: Record<string, unknown> = {};
    if (input.shift_start !== undefined) shiftUpdate.start_time = input.shift_start;
    if (input.shift_end !== undefined) shiftUpdate.end_time = input.shift_end;
    if (input.days_of_week !== undefined) shiftUpdate.days_of_week = parseWeekLabel(input.days_of_week);
    await Shift.findOneAndUpdate({ user_id: id }, shiftUpdate, { upsert: true, setDefaultsOnInsert: true });
  }

  const embedding = await FaceEmbedding.exists({ user_id: id });
  return toEmployeeDTO({ ...user, has_face_embedding: Boolean(embedding) });
}

/** PATCH /employees/:id/photo — regenerates the embedding, per 01-API-CONTRACT.md. */
export async function updateEmployeePhoto(id: string, referencePhotoUrl: string) {
  const user = await User.findByIdAndUpdate(id, { reference_photo_url: referencePhotoUrl }, { new: true })
    .populate('office_id', 'office_name')
    .lean();
  if (!user) throw new AdminApiError(404, 'NOT_FOUND', 'Employee not found.');

  await tryGenerateEmbedding(id, referencePhotoUrl);
  const embedding = await FaceEmbedding.exists({ user_id: id });
  return toEmployeeDTO({ ...user, has_face_embedding: Boolean(embedding) });
}

/** DELETE /employees/:id — soft delete, keeps history, per 01-API-CONTRACT.md. */
export async function deactivateEmployee(id: string): Promise<void> {
  const user = await User.findByIdAndUpdate(id, { is_active: false });
  if (!user) throw new AdminApiError(404, 'NOT_FOUND', 'Employee not found.');
}
