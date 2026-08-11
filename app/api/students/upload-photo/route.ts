import { NextRequest, NextResponse } from 'next/server';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { savePhotoFile, isAllowedPhotoType, MAX_PHOTO_SIZE } from '@/lib/uploads';

/* ─────────────────────────────────────────
   POST /api/students/upload-photo
   Ported from students.js `router.post('/upload-photo', ...)`.
   multer's disk storage + fileFilter/limits are replicated in
   lib/uploads.ts; here we just pull the file out of FormData.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.add');
  if (denied) return denied;

  try {
    const formData = await req.formData();
    const file = formData.get('photo');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Photo file is required.' }, { status: 400 });
    }
    if (!isAllowedPhotoType(file.type)) {
      // Mirrors multer's fileFilter silently rejecting disallowed types
      // (cb(null, false) -> no req.file -> "Photo file is required.").
      return NextResponse.json({ error: 'Photo file is required.' }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_SIZE) {
      return NextResponse.json({ error: 'Photo file is too large (max 5MB).' }, { status: 400 });
    }

    const url = await savePhotoFile(file, {
      class: formData.get('class'),
      section: formData.get('section'),
      roll_no: formData.get('roll_no'),
      gender: formData.get('gender'),
    });

    return NextResponse.json({ url });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
