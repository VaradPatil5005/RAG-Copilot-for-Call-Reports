/** Maps the `code` returned by next-auth's signIn() (see SignInFailure in
 * src/auth.ts) to a user-facing message. */
export function signInErrorMessage(res: { error?: string | null; code?: string | null } | undefined): string | null {
  if (!res?.error) return null;
  switch (res.code) {
    case "captcha":
      return "Security check failed. Please complete the CAPTCHA and try again.";
    case "rate_limited":
      return "Too many sign-in attempts. Please wait 15 minutes and try again.";
    case "locked":
      return "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes.";
    case "inactive":
      return "This account is not active. Please contact your administrator.";
    default:
      return "Invalid email or password.";
  }
}

/** One-click demo accounts are only offered when explicitly enabled for
 * local development -- never in a production build, where they would
 * publish working super-admin credentials on the login page. */
export const DEMO_LOGINS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGINS === "true" && process.env.NODE_ENV !== "production";
