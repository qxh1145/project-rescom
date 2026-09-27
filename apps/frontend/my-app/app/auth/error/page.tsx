import { redirect } from "next/navigation";

const ERROR_CODE_PATTERN = /^[A-Z_]{1,64}$/;

/**
 * Backend `AUTH_FRONTEND_ERROR_URL?error=<CODE>` → the login page shows the
 * message, except AUTH_GOOGLE_LINK_REQUIRED (Google email already registered
 * with a password), which opens the 15d link screen.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  const code = typeof error === "string" && ERROR_CODE_PATTERN.test(error) ? error : "UNKNOWN";
  redirect(code === "AUTH_GOOGLE_LINK_REQUIRED" ? "/auth/link-google" : `/login?error=${code}`);
}
