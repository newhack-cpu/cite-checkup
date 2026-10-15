import type { ClaimErrorCode } from "./types";

/** Messages are fixed local text; never wrap native upstream messages or bodies. */
export class ClaimError extends Error {
  constructor(readonly code: ClaimErrorCode, message: string) { super(message); }
}
