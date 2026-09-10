export type ContentMessage =
  | { type: "LOGIN_FORM_VISIBLE" }
  | { type: "ENTER_MANUAL" }
  | { type: "RETRY_AUTOMATIC" }
  | { type: "GET_UI_STATE" };

export type LoginRecoveryResult =
  | { kind: "idle" }
  | { kind: "navigating" }
  | { kind: "manual_required"; message: string };
