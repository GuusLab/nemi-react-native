import { NemiError } from "./core";

/**
 * Base class for the errors this package adds. It extends the core
 * `NemiError`, so `err instanceof NemiError` catches everything. Token
 * endpoint failures are the core's `NemiOAuthError`.
 */
export class NemiNativeError extends NemiError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NemiNativeError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The person closed the browser or dismissed the sign-in sheet. Not a failure. */
export class NemiCancelledError extends NemiNativeError {
  constructor(message = "Sign in was cancelled.") {
    super("cancelled", message);
    this.name = "NemiCancelledError";
  }
}

/** The `state` in the redirect did not match the one we sent (or none was pending). */
export class NemiStateMismatchError extends NemiNativeError {
  constructor(message = "The sign in response did not match the request (state mismatch).") {
    super("state_mismatch", message);
    this.name = "NemiStateMismatchError";
  }
}

/** The person pressed Deny on the consent screen. */
export class NemiAccessDeniedError extends NemiNativeError {
  constructor(message = "Access was denied on the consent screen.") {
    super("access_denied", message);
    this.name = "NemiAccessDeniedError";
  }
}

/** An operation needs a signed-in person, but there is no session. */
export class NemiNotSignedInError extends NemiNativeError {
  constructor(message = "Nobody is signed in.") {
    super("not_signed_in", message);
    this.name = "NemiNotSignedInError";
  }
}

/** A required native module (for example expo-secure-store) is missing. */
export class NemiConfigurationError extends NemiNativeError {
  constructor(message: string) {
    super("configuration", message);
    this.name = "NemiConfigurationError";
  }
}
