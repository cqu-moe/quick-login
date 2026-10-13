import { PostHog } from "posthog-js/dist/module.no-external";
export { sanitizePostHogEvent, telemetryErrorCode } from "./posthog-privacy";
import { sanitizePostHogEvent } from "./posthog-privacy";
import { readLocalState } from "../background/storage";
import type { LocalState } from "./contracts";

export type QuickLoginOperation =
  | "connect"
  | "sync"
  | "cookie_apply"
  | "enable"
  | "disable"
  | "resume"
  | "switch_managed";

export type QuickLoginOutcome =
  | "success"
  | "failure"
  | "partial"
  | "canceled"
  | "needs_input"
  | "unverified";

export type QuickLoginTrigger = "user" | "automatic" | "scheduled" | "recovery";

export interface QuickLoginOperationTelemetry {
  outcome: QuickLoginOutcome;
  trigger: QuickLoginTrigger;
  durationMs: number;
  operationId?: string;
  noOp?: boolean;
  verification?: "unverified";
  errorCode?: string;
}

const SEND_LIMIT_MS = 5_000;
const MAX_ACTIVE_SENDS = 4;

let clientFlight: { distinctId: string; client: Promise<PostHog | null> } | null = null;

async function client(distinctId: string): Promise<PostHog | null> {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return null;
  if (clientFlight?.distinctId !== distinctId) {
    clientFlight = {
      distinctId,
      client: (async () => {
        const instance = new PostHog();
        instance.init(token, {
          api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://p.cqu.moe",
          ui_host: "https://us.posthog.com",
          defaults: "2026-05-30",
          bootstrap: { distinctID: distinctId },
          persistence: "memory",
          disable_external_dependency_loading: true,
          capture_pageview: false,
          capture_pageleave: false,
          autocapture: false,
          rageclick: false,
          capture_performance: false,
          capture_heatmaps: false,
          capture_dead_clicks: false,
          disable_session_recording: true,
          disable_surveys: true,
          disable_surveys_automatic_display: true,
          disable_product_tours: true,
          disable_conversations: true,
          disable_web_experiments: true,
          logs: { captureConsoleLogs: false },
          save_referrer: false,
          save_campaign_params: false,
          disable_scroll_properties: true,
          advanced_disable_flags: true,
          request_batching: false,
          person_profiles: "never",
          capture_exceptions: false,
          before_send: event => sanitizePostHogEvent(event),
          ip: false,
        });
        return instance;
      })().catch((error: unknown) => {
        clientFlight = null;
        throw error;
      }),
    };
  }
  return clientFlight.client;
}

const activeSends = new Set<Promise<void>>();

function nonProductionSendAllowed(): boolean {
  return import.meta.env.VITE_POSTHOG_ALLOW_NON_PRODUCTION === "true";
}

function telemetryIdentity(
  state: Pick<LocalState, "authorization" | "centralUserId" | "installationId">
): { distinctId: string; actorType: "user" | "installation" } {
  if (state.centralUserId !== null &&
      (state.authorization === "authorized" || state.authorization === "refreshing_token")) {
    return { distinctId: state.centralUserId, actorType: "user" };
  }
  return { distinctId: state.installationId, actorType: "installation" };
}

function withSendLimit(action: () => Promise<void> | void): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    (async () => action())(),
    new Promise<void>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("TELEMETRY_SEND_TIMEOUT")), SEND_LIMIT_MS);
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function dispatch(
  action: (instance: PostHog, actorType: "user" | "installation") => Promise<void> | void
): void {
  if (!import.meta.env.PROD && !nonProductionSendAllowed()) return;
  if (activeSends.size >= MAX_ACTIVE_SENDS) return;
  const send = (async () => {
    const state = await readLocalState();
    const identity = telemetryIdentity(state);
    const instance = await client(identity.distinctId);
    if (!instance) return;
    await withSendLimit(() => action(instance, identity.actorType));
  })().catch(() => {
    // Telemetry must never change extension behavior.
  }).finally(() => activeSends.delete(send));
  activeSends.add(send);
}

function commonProperties(actorType: "user" | "installation"): Record<string, unknown> {
  const mode = import.meta.env.MODE;
  return {
    telemetry_version: 2,
    product: "quicklogin",
    surface: "extension",
    actor_type: actorType,
    environment: import.meta.env.PROD ? "production" : mode === "test" ? "test" : "development",
    release: __QUICKLOGIN_BUILD_ID__,
    extension_release_version: chrome.runtime.getManifest().version,
    ...(!import.meta.env.PROD ? { is_test: true } : {}),
    $process_person_profile: false,
  };
}

export function durationFrom(startedAt: number): number {
  const duration = Math.max(0, Math.round(Date.now() - startedAt));
  return Number.isSafeInteger(duration) ? duration : 0;
}

export function captureQuickloginOperation(
  operation: QuickLoginOperation,
  telemetry: QuickLoginOperationTelemetry
): void {
  dispatch(async (instance, actorType) => {
    await instance.capture("quicklogin_operation_completed", {
      ...commonProperties(actorType),
      operation,
      outcome: telemetry.outcome,
      trigger: telemetry.trigger,
      duration_ms: telemetry.durationMs,
      duration_basis: "local_operation",
      operation_id: telemetry.operationId ?? crypto.randomUUID(),
      ...(telemetry.noOp ? { no_op: true } : {}),
      ...(telemetry.verification ? { verification: telemetry.verification } : {}),
      ...(telemetry.errorCode ? { error_code: telemetry.errorCode } : {}),
    }, { send_instantly: true });
  });
}

export function telemetryTrigger(reason: "alarm" | "startup" | "network" | "enable" | "login_form" | "user_retry" | "popup"): QuickLoginTrigger {
  if (reason === "alarm") return "scheduled";
  if (reason === "login_form") return "recovery";
  if (reason === "user_retry" || reason === "popup" || reason === "enable") return "user";
  return "automatic";
}
