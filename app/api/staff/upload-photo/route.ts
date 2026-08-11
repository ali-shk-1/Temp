import { NextRequest, NextResponse } from 'next/server';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { saveStaffPhotoFile, isAllowedPhotoType, MAX_PHOTO_SIZE } from '@/lib/uploads';

/* ─────────────────────────────────────────
   POST /api/staff/upload-photo
   Mirrors /api/students/upload-photo but saves into a single flat
   folder (uploads/staff/) named by CNIC — no nested class/section/
   gender subfolders like the student photo layout uses.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.add');
  if (denied) return denied;

  try {
    const formData = await req.formData();
    const file = formData.get('photo');
    const cnic = formData.get('cnic');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Photo file is required.' }, { status: 400 });
    }
    if (!cnic) {
      return NextResponse.json({ error: 'cnic is required.' }, { status: 400 });
    }
    if (!isAllowedPhotoType(file.type)) {
      return NextResponse.json({ error: 'Photo file is required.' }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_SIZE) {
      return NextResponse.json({ error: 'Photo file is too large (max 5MB).' }, { status: 400 });
    }

    const url = await saveStaffPhotoFile(file, cnic);

    return NextResponse.json({ url });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
