import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url && key && !url.includes("YOUR_PROJECT") && !key.includes("YOUR_"),
);
export const supabase = configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
};
export type Connection = {
  id: string;
  user_low: string;
  user_high: string;
  created_at: string;
};
export type Note = {
  owner_id: string;
  connection_id: string;
  notes: string;
  tags: string[];
};
export type Contact = {
  id: string;
  owner_id: string;
  kind: "email" | "phone" | "link";
  label: string;
  value: string;
  share_default: boolean;
};
export type Override = {
  contact_id: string;
  recipient_id: string;
  allowed: boolean;
};
export type Pending = {
  id: string;
  incoming: boolean;
  display_name: string;
  username: string;
  expires_at: string;
};
export type Invite = { token: string; expires_at: string };
export type Preview = Pick<Profile, "display_name" | "username"> & {
  expires_at: string;
};
export type Snapshot = {
  profiles: Profile[];
  connections: Connection[];
  notes: Note[];
  contacts: Contact[];
  overrides: Override[];
  pending: Pending[];
};
export const emptySnapshot: Snapshot = {
  profiles: [],
  connections: [],
  notes: [],
  contacts: [],
  overrides: [],
  pending: [],
};

export function routeToken(hash: string): string | null {
  return /^#\/handshake\/([a-f0-9]{64})$/.exec(hash)?.[1] ?? null;
}
export function handshakeUrl(token: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/handshake/${token}`;
}
export function tokenFromInput(value: string): string | null {
  try {
    const candidate = new URL(value);
    const here = new URL(location.href);
    if (
      candidate.origin !== here.origin ||
      candidate.pathname !== here.pathname ||
      candidate.search
    )
      return null;
    return routeToken(candidate.hash);
  } catch {
    return null;
  }
}
export function normalizeTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}
export function contactHref(c: Contact): string | undefined {
  if (c.kind === "link") {
    try {
      const u = new URL(c.value);
      return u.protocol === "https:" ? u.href : undefined;
    } catch {
      return undefined;
    }
  }
  if (c.kind === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.value))
    return `mailto:${c.value.split("@").map(encodeURIComponent).join("@")}`;
  if (c.kind === "phone" && /^\+?[0-9 ()-]{3,40}$/.test(c.value))
    return `tel:${c.value.replace(/[ ()-]/g, "")}`;
  return undefined;
}
export function failIf(
  error: { message?: string; code?: string } | null,
): void {
  if (error) throw error;
}
export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e.code === "23505")
    return "That username or entry is already in use. Refresh and try again.";
  if (e.code === "23514") return "Check the format and length of your entries.";
  const safe = [
    "Complete your profile first.",
    "Handshake unavailable.",
    "Handshake unavailable. Ask for a fresh link.",
    "Please wait before creating another Handshake.",
    "Please wait before requesting another Handshake.",
    "You are already connected.",
    "A Handshake is already awaiting approval.",
    "Request unavailable.",
    "Request expired or already handled.",
    "Only the creator can approve this request.",
    "Connection unavailable.",
    "Invalid login credentials",
    "Email not confirmed",
    "User already registered",
    "Sign in first.",
  ];
  return safe.includes(e.message ?? "")
    ? e.message!
    : "Unable to complete that action. Check your connection and try again.";
}
export async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase!.rpc(name, args);
  failIf(error);
  return data as T;
}
export async function loadSnapshot(): Promise<Snapshot> {
  const results = await Promise.all([
    supabase!.from("profiles").select("*"),
    supabase!
      .from("connections")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase!.from("connection_notes").select("*"),
    supabase!.from("contact_methods").select("*"),
    supabase!.from("contact_overrides").select("*"),
    supabase!.rpc("pending_handshakes"),
  ]);
  results.forEach((r) => failIf(r.error));
  return {
    profiles: results[0].data as Profile[],
    connections: results[1].data as Connection[],
    notes: results[2].data as Note[],
    contacts: results[3].data as Contact[],
    overrides: results[4].data as Override[],
    pending: results[5].data as Pending[],
  };
}
