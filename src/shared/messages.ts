export const CONTENT_MESSAGE_TYPES = [
  "LOGIN_FORM_VISIBLE", "CHECK_STATE", "ENTER_MANUAL", "RETRY_AUTOMATIC", "OPEN_SETTINGS",
  "LOGIN", "OPEN_EXTENSION_SETTINGS", "CHECK_EXTENSION_UPDATE", "GET_UI_STATE",
] as const;

export type ContentMessage = { type: typeof CONTENT_MESSAGE_TYPES[number] };

export type ContentAction =
  | "ENTER_MANUAL"
  | "RETRY_AUTOMATIC"
  | "OPEN_SETTINGS"
  | "LOGIN"
  | "OPEN_EXTENSION_SETTINGS"
  | "CHECK_EXTENSION_UPDATE";

export type LoginRecoveryResult =
  | { kind: "idle" }
  | { kind: "recovering"; message: string; action?: { type: ContentAction; label: string } | null }
  | { kind: "navigating" }
  | { kind: "manual_required"; message: string; action?: { type: ContentAction; label: string } | null };
