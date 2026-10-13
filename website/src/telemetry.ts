import { PostHog } from "posthog-js/dist/module.no-external";
import "posthog-js/dist/lazy-recorder";
import { sanitizePostHogEvent } from "../../src/shared/posthog-privacy";

type RecordingLocation = Pick<Location, "origin" | "href">;

declare const __QUICKLOGIN_WEBSITE_RELEASE__: string;

const DYNAMIC_TEXT_SELECTOR = [
  "[data-download]",
  "[data-release]",
  "[data-release-status]",
  "[data-copy]",
  "[data-copy-state]",
  ".article",
].join(",");

const BLOCKED_RECORDING_SELECTOR = [
  "img",
  "picture",
  "svg",
  "iframe",
  "video",
  "audio",
  "canvas",
  "[data-download]",
  "[data-release]",
].join(",");

export function isAllowedRecordingLocation(location: RecordingLocation): boolean {
  return location.origin === "https://quicklogin.cqu.moe";
}

function commonProperties(): Record<string, unknown> {
  return {
    telemetry_version: 2,
    product: "quicklogin",
    surface: "web",
    actor_type: "user",
    environment: import.meta.env.PROD ? "production" : import.meta.env.MODE === "test" ? "test" : "development",
    release: __QUICKLOGIN_WEBSITE_RELEASE__,
    ...(!import.meta.env.PROD || new URLSearchParams(window.location.search).get("telemetry_test") === "1" ? { is_test: true } : {}),
    $process_person_profile: false,
  };
}

export function initializeWebsiteTelemetry(
  location: RecordingLocation = window.location,
): PostHog | null {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token || !isAllowedRecordingLocation(location)) return null;
  if (!import.meta.env.PROD && import.meta.env.VITE_POSTHOG_ALLOW_NON_PRODUCTION !== "true") return null;

  const client = new PostHog();
  client.init(token, {
    api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://p.cqu.moe",
    asset_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://p.cqu.moe",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    persistence: "localStorage",
    disable_external_dependency_loading: true,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    rageclick: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    logs: { captureConsoleLogs: false },
    save_referrer: false,
    save_campaign_params: false,
    disable_scroll_properties: true,
    advanced_disable_feature_flags: true,
    person_profiles: "never",
    capture_exceptions: false,
    ip: false,
    disable_session_recording: false,
    session_recording: {
      sampleRate: 1,
      maskAllInputs: true,
      maskTextSelector: DYNAMIC_TEXT_SELECTOR,
      maskTextFn: () => "[masked]",
      maskAllElementAttributes: true,
      blockSelector: BLOCKED_RECORDING_SELECTOR,
      slimDOMOptions: "all",
      collectFonts: false,
      captureJsonLd: false,
      recordCrossOriginIframes: false,
      recordHeaders: false,
      recordBody: false,
      streamNetworkBody: false,
      captureCanvas: { recordCanvas: false },
      maskCapturedNetworkRequestFn: (request) => {
        // The recorder also invokes this hook for page metadata with only a name.
        if (Object.keys(request).length !== 1) return null;
        try {
          return new URL(request.name).origin === "https://quicklogin.cqu.moe"
            ? { ...request, name: "https://quicklogin.cqu.moe/" } : null;
        } catch { return null; }
      },
    },
    before_send: (event) => {
      if (!isAllowedRecordingLocation(location)) return null;
      const sanitized = sanitizePostHogEvent(event, "web");
      if (!sanitized) return null;
      return {
        ...sanitized,
        properties: {
          ...commonProperties(),
          ...sanitized.properties,
          $process_person_profile: false,
        },
      };
    },
  });
  client.startSessionRecording(true);
  client.capture("$pageview", commonProperties());
  return client;
}
