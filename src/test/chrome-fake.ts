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
  const tabUpdates: Array<{ tabId: number; properties: chrome.tabs.UpdateProperties }> = [];
  const cookieStore = new Map<string, chrome.cookies.Cookie>();
  const cookieKey = (cookie: Pick<chrome.cookies.Cookie, "storeId" | "domain" | "path" | "name">) =>
    `${cookie.storeId}\0${cookie.domain}\0${cookie.path}\0${cookie.name}`;
  const fake = {
    storage: { local: area(local), session: area(session), onChanged:event() },
    alarms: {
      get: async (name: string) => alarms.get(name),
      create: (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000,
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
    cookies: {
      getAllCookieStores: async () => [{ id: "0", tabIds: [1], incognito: false }],
      get: async (details: chrome.cookies.CookieDetails) => {
        const url = new URL(details.url);
        const storeId = details.storeId ?? "0";
        return [...cookieStore.values()]
          .filter((cookie) =>
            cookie.name === details.name && cookie.storeId === storeId &&
            (cookie.hostOnly
              ? cookie.domain === url.hostname
              : url.hostname === cookie.domain.replace(/^\./, "") ||
                url.hostname.endsWith(cookie.domain)) &&
            url.pathname.startsWith(cookie.path)
          )
          .sort((left, right) => right.path.length - left.path.length)[0];
      },
      getAll: async (details: chrome.cookies.GetAllDetails) => [...cookieStore.values()].filter((cookie) =>
        (!details.name || cookie.name === details.name) &&
        (!details.storeId || cookie.storeId === details.storeId) &&
        (!details.domain || cookie.domain.replace(/^\./, "") === details.domain.replace(/^\./, ""))
      ),
      set: async (details: chrome.cookies.SetDetails) => {
        const host = new URL(details.url).hostname;
        const cookie: chrome.cookies.Cookie = {
          name: details.name ?? "",
          value: details.value ?? "",
          domain: details.domain ?? host,
          hostOnly: details.domain === undefined,
          path: details.path ?? "/",
          secure: details.secure ?? true,
          httpOnly: details.httpOnly ?? false,
          sameSite: details.sameSite ?? "unspecified",
          session: details.expirationDate === undefined,
          expirationDate: details.expirationDate,
          storeId: details.storeId ?? "0",
        };
        cookieStore.set(cookieKey(cookie), cookie);
        return cookie;
      },
      remove: async (details: chrome.cookies.CookieDetails) => {
        const path = new URL(details.url).pathname || "/";
        const found = [...cookieStore.values()].find((cookie) =>
          cookie.name === details.name && cookie.storeId === (details.storeId ?? "0") && cookie.path === path
        );
        if (!found) return null;
        cookieStore.delete(cookieKey(found));
        return { url: details.url, name: details.name, storeId: found.storeId };
      },
      onChanged: event(),
    },
    runtime: {
      id: "test-extension",
      getManifest:()=>({version:"0.2.0"}),
      reload: () => undefined,
      requestUpdateCheck: async () => ({ status: "no_update" }),
      onUpdateAvailable: event(),
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      onMessageExternal:event(),
      sendMessage: async () => ({ kind: "idle" }),
    },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      sendMessage: async () => undefined,
      update: async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
        tabUpdates.push({ tabId, properties });
        return { id: tabId, ...properties } as chrome.tabs.Tab;
      },
      create: async (properties: chrome.tabs.CreateProperties) => ({
        id: 8, ...properties,
      }) as chrome.tabs.Tab,
    },
  } as unknown as typeof chrome;
  Object.assign(globalThis, { chrome: fake });
  return {
    fake, local, session, alarms, cookieStore, tabUpdates,
    getCookie: (name: string, path = "/", storeId = "0") =>
      [...cookieStore.values()].find((cookie) =>
        cookie.name === name && cookie.path === path && cookie.storeId === storeId
      ) ?? null,
  };
}
