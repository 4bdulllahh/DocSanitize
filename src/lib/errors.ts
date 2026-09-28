import { msg } from "@/i18n/msg";
export type ProcessingErrorCode = "encrypted" | "unsupported" | "corrupt" | "invalid";

/** An expected failure with a user-facing message, e.g. a password-protected or damaged file. */
export class ProcessingError extends Error {
  constructor(
    message: string,
    readonly code: ProcessingErrorCode,
  ) {
    super(message);
    this.name = "ProcessingError";
  }
}

export function errorMessage(error: unknown, fallback = msg("Something went wrong while processing this file.")): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
