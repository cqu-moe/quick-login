export type ContentMessage =
  | { type: "LOGIN_FORM_VISIBLE" }
  | { type: "CHECK_STATE" }
  | { type: "ENTER_MANUAL" }
  | { type: "RETRY_AUTOMATIC" }
  | { type: "OPEN_SETTINGS" }
  | { type: "LOGIN" }
  | { type: "SWITCH_TO_MANAGED" }
  | { type: "OPEN_EXTENSION_SETTINGS" }
  | { type: "CHECK_EXTENSION_UPDATE" }
  | { type: "GET_UI_STATE" };

export type ContentAction =
  | "ENTER_MANUAL"
  | "RETRY_AUTOMATIC"
  | "OPEN_SETTINGS"
  | "LOGIN"
  | "SWITCH_TO_MANAGED"
  | "OPEN_EXTENSION_SETTINGS"
  | "CHECK_EXTENSION_UPDATE";

export type LoginRecoveryResult =
  | { kind: "idle" }
  | { kind: "recovering"; message: string; action?: { type: ContentAction; label: string } | null }
  | { kind: "navigating" }
  | { kind: "manual_required"; message: string; action?: { type: ContentAction; label: string } | null };
