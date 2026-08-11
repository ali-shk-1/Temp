import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // photo_url values are stored/returned as bare /uploads/... (see
  // lib/uploads.ts savePhotoFile), but Next.js API routes can't serve
  // files the way express.static did — the actual file-serving logic
  // lives at app/api/uploads/[...path]/route.ts. This rewrite makes
  // /uploads/... requests resolve to that route transparently, so
  // <img src={photo_url}> keeps working without changing every
  // reference to /api/uploads/... throughout the app.
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/uploads/:path*",
      },
    ];
  },
};

export default nextConfig;