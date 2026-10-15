export type ContentMessage =
  | { type: "LOGIN_FORM_VISIBLE" }
  | { type: "CHECK_STATE" }
  | { type: "ENTER_MANUAL" }
  | { type: "RETRY_AUTOMATIC" }
  | { type: "GET_UI_STATE" };

export type LoginRecoveryResult =
  | { kind: "idle" }
  | { kind: "recovering"; message: string }
  | { kind: "navigating" }
  | { kind: "manual_required"; message: string };
