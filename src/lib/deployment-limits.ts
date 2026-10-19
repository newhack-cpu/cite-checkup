// Public deployment profile, inlined by Next.js at build time on both client and server.
// This is a capability flag, never a place for credentials.
const netlify = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "netlify";

// Leave headroom for multipart headers and Netlify's base64-encoded request envelope.
export const UPLOAD_LIMIT_MIB = netlify ? 4 : 8;
export const UPLOAD_LIMIT_BYTES = UPLOAD_LIMIT_MIB * 1024 * 1024;

// Respond before the hosting platform's 60-second hard termination.
export const HOSTED_REQUEST_TIMEOUT_MS = netlify ? 50_000 : undefined;
