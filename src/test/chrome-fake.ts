type Stored = Record<string, unknown>;

function area(store: Stored): chrome.storage.StorageArea {
  return {
    get: async (keys?: string | string[] | null) => {
      if (keys == null) return { ...store };
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.map((key) => [key, store[key]]));
    },
    set: async (items: Stored) => { Object.assign(store, items); },
    remove: async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete store[key];
    },
    clear: async () => { for (const key of Object.keys(store)) delete store[key]; },
    getBytesInUse: async () => 0,
    getKeys: async () => Object.keys(store),
    setAccessLevel: async () => undefined,
    onChanged: { addListener() {}, removeListener() {}, hasListener: () => false } as never,
    QUOTA_BYTES: 10_485_760,
  } as unknown as chrome.storage.StorageArea;
}

function event<T extends (...args: any[]) => void>(): chrome.events.Event<T> {
  return { addListener() {}, removeListener() {}, hasListener: () => false } as never;
}

export function installChromeFake() {
  const local: Stored = {};
  const session: Stored = {};
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const fake = {
    storage: { local: area(local), session: area(session) },
    alarms: {
      get: async (name: string) => alarms.get(name),
      create: (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: Date.now(),
          periodInMinutes: info.periodInMinutes,
          persistAcrossSessions: true,
        });
      },
      clear: async (name: string) => alarms.delete(name),
      onAlarm: event(),
    },
    identity: {
      getRedirectURL: () => "https://test-extension.chromiumapp.org/",
      launchWebAuthFlow: async () => undefined,
    },
    runtime: {
      id: "test-extension",
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
    },
  } as unknown as typeof chrome;
  Object.assign(globalThis, { chrome: fake });
  return { fake, local, session, alarms };
}
