export type EventLike = {
  event: string;
  uuid?: unknown;
  timestamp?: unknown;
  properties: Record<string, unknown>;
};

const REDACTED = "[redacted]";
const TRANSPORT_KEYS = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
]);
const BUSINESS_KEYS = new Set([
  "telemetry_version",
  "product",
  "surface",
  "actor_type",
  "environment",
  "release",
  "extension_release_version",
  "is_test",
  "$process_person_profile",
  "operation",
  "outcome",
  "trigger",
  "duration_ms",
  "duration_basis",
  "operation_id",
  "no_op",
  "verification",
  "error_code",
]);
const PAGEVIEW_KEYS = new Set(["$current_url"]);
const IDENTIFY_KEYS = new Set(["$anon_distinct_id", "$user_id"]);
const SNAPSHOT_KEYS = new Set([
  ...TRANSPORT_KEYS,
  "$snapshot_data",
  "$snapshot_bytes",
  "$snapshot_host",
  "$sdk_debug_replay_unstringifiable_events_dropped",
  "$process_person_profile",
]);
function sanitizeUrl(value: unknown): string {
  try {
    return new URL(String(value)).origin === "https://quicklogin.cqu.moe"
      ? "https://quicklogin.cqu.moe/" : REDACTED;
  } catch {
    return REDACTED;
  }
}

function keepProperties(
  properties: Record<string, unknown>,
  keys: Set<string>,
  sanitizeKeys: Set<string> = new Set()
): Record<string, unknown> {
  return Object.fromEntries(
    [...keys].filter(key => key in properties)
      .map(key => [key, sanitizeKeys.has(key) ? sanitizeUrl(properties[key]) : properties[key]])
  );
}

export function sanitizePostHogEvent<T extends EventLike>(event: T | null, surface: "extension" | "web" = "extension"): T | null {
  if (!event) return null;
  const allowedEvents = surface === "web"
    ? ["$pageview", "$identify", "$snapshot"]
    : ["quicklogin_operation_completed", "$identify"];
  if (!allowedEvents.includes(event.event)) return null;
  const properties = event.properties ?? {};
  let allowedProperties: Record<string, unknown>;
  if (event.event === "$snapshot") {
    // Snapshot payloads contain recorder-compressed DOM data. They are masked by the
    // recorder itself before capture and must not be recursively decoded or rewritten.
    allowedProperties = keepProperties(properties, SNAPSHOT_KEYS);
  } else if (event.event === "$identify") {
    allowedProperties = keepProperties(properties, new Set([...TRANSPORT_KEYS, ...IDENTIFY_KEYS, "$process_person_profile"]));
  } else {
    allowedProperties = keepProperties(
      properties,
      new Set([...TRANSPORT_KEYS, ...BUSINESS_KEYS, ...PAGEVIEW_KEYS]),
      new Set([...PAGEVIEW_KEYS])
    );
  }
  // Proxy health checks need this SDK marker; retain only our approved origin.
  if (properties.$lib_custom_api_host === "https://p.cqu.moe") {
    allowedProperties.$lib_custom_api_host = properties.$lib_custom_api_host;
  }
  allowedProperties.$geoip_disable = true;
  return {
    event: event.event,
    ...(event.uuid !== undefined ? { uuid: event.uuid } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    properties: allowedProperties,
  } as T;
}

export function telemetryErrorCode(error: unknown): string {
  const candidate = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : "UNEXPECTED_ERROR";
}
