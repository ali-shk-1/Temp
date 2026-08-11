import fs from 'fs';
import path from 'path';

// Mirrors the original: uploads/ lives inside the backend folder. In this
// Next.js project it lives at the project root's /uploads, served via
// /api/uploads/[...path]/route.ts (Next.js API routes can't use
// express.static, so we serve files manually — see that route).
export const uploadsDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Turns a raw form field into a safe folder-name segment: lowercased,
 * trimmed, and stripped of anything that isn't a letter/digit/dash/
 * underscore — ported verbatim from students.js `safeSegment`.
 */
export function safeSegment(value: unknown): string | null {
  if (value == null) return null;
  const cleaned = String(value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return cleaned || null;
}

/**
 * Photos are organized as uploads/<gender>/<class>/<section>/<roll_no>.ext
 * Ported from students.js `resolveUploadDir`, adapted to take plain field
 * values (extracted from FormData) instead of an Express req object.
 */
export function resolveUploadDir(fields: {
  class?: unknown;
  section?: unknown;
  roll_no?: unknown;
  gender?: unknown;
}): string {
  const cls = safeSegment(fields.class);
  const section = safeSegment(fields.section);
  const rollNo = safeSegment(fields.roll_no);
  if (!cls || !section || !rollNo) return uploadsDir;

  const genderRaw = safeSegment(fields.gender);
  // gender is now a required field on student create/edit (see
  // app/api/students/route.ts and [id]/route.ts), so genderRaw should
  // always resolve to 'm' or 'f' here. If it somehow doesn't (e.g. a
  // pre-existing record from before gender was made mandatory, or a
  // direct/legacy API call bypassing that validation), fall back to the
  // shared uploads root rather than inventing an "unspecified" bucket.
  if (genderRaw !== 'male' && genderRaw !== 'm' && genderRaw !== 'female' && genderRaw !== 'f') {
    return uploadsDir;
  }
  const genderFolder = genderRaw === 'male' || genderRaw === 'm' ? 'm' : 'f';

  return path.join(uploadsDir, genderFolder, cls, section);
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB, mirrors multer limits.fileSize

export function isAllowedPhotoType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

/**
 * Saves an uploaded File (from FormData) to the resolved directory,
 * mirroring multer's filename logic: uses roll_no as the filename when
 * available, otherwise a random token. Returns the public /uploads/... URL.
 */
export async function savePhotoFile(
  file: File,
  fields: { class?: unknown; section?: unknown; roll_no?: unknown; gender?: unknown }
): Promise<string> {
  let dir: string;
  try {
    dir = resolveUploadDir(fields);
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    dir = uploadsDir;
  }

  const rollNo = safeSegment(fields.roll_no);
  const ext = path.extname(file.name);
  const filename = rollNo ? `${rollNo}${ext}` : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

  // dir is always a subpath of uploadsDir (see resolveUploadDir above),
  // but it's computed at runtime from user-supplied fields, so Turbopack's
  // static analysis can't verify that and would otherwise trace/bundle
  // the entire project as a precaution. Safe to ignore here.
  const destPath = path.join(/* turbopackIgnore: true */ dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(destPath, buffer);

  const relative = path.relative(uploadsDir, destPath).split(path.sep).join('/');
  return `/uploads/${relative}`;
}

/**
 * Staff photos are organized as a single flat folder: uploads/staff/<cnic>.ext
 * (no nested subfolders, unlike student photos) — filename is the staff
 * member's CNIC with punctuation stripped, so it's stable and collision-free
 * (CNIC is unique per staff member).
 */
export const staffUploadsDir = path.join(uploadsDir, 'staff');

export function resolveStaffPhotoFilename(cnic: unknown, originalName: string): string | null {
  const safeCnic = safeSegment(cnic);
  if (!safeCnic) return null;
  const ext = path.extname(originalName);
  return `${safeCnic}${ext}`;
}

/**
 * Saves an uploaded staff photo File (from FormData) directly under
 * uploads/staff/, named <cnic>.<ext> — overwrites any existing photo for
 * that CNIC (e.g. on re-upload/edit), matching "one photo per staff member".
 */
export async function saveStaffPhotoFile(file: File, cnic: unknown): Promise<string> {
  fs.mkdirSync(staffUploadsDir, { recursive: true });

  const filename = resolveStaffPhotoFilename(cnic, file.name);
  const finalFilename = filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.name)}`;

  const destPath = path.join(/* turbopackIgnore: true */ staffUploadsDir, finalFilename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(destPath, buffer);

  return `/uploads/staff/${finalFilename}`;
}

/** Deletes a photo file given its public /uploads/... URL, ignoring ENOENT. */
export function deletePhotoByUrl(photoUrl: string | null | undefined): void {
  if (!photoUrl || !photoUrl.startsWith('/uploads/')) return;
  const relativePath = photoUrl.replace(/^\/uploads\//, '');
  const photoPath = path.join(uploadsDir, relativePath);
  fs.unlink(photoPath, (err) => {
    if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to delete photo:', photoPath, err.message);
    }
  });
}