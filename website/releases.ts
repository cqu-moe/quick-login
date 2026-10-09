import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
export function releaseContent(directory: string, currentVersion: string) {
  const entries = readdirSync(directory).filter(name => /^\d+\.\d+\.\d+\.md$/.test(name)).map(name => {
    const version = name.slice(0, -3);
    const source = readFileSync(resolve(directory, name), "utf8");
    const date = source.match(/^Date: (\d{4}-\d{2}-\d{2})$/m)?.[1];
    const notes = [...source.matchAll(/^- (.+)$/gm)].map(match => match[1]);
    if (!date || !notes.length || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`Missing or invalid release date/notes: ${name}`);
    return { version, date, notes };
  }).sort((a, b) => {
    const left = a.version.split(".").map(Number), right = b.version.split(".").map(Number);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
  if (entries[0]?.version !== currentVersion) throw new Error("Current version must have the newest release notes");
  const html = entries.map(({ version, date, notes }) => `<article class="changelog-entry" id="v${version}"><time datetime="${date}">${date.replaceAll("-", ".")}</time><div><h2>${version} <span class="tag">内测</span></h2><ul>${notes.map(note => `<li>${escape(note)}</li>`).join("")}</ul></div></article>`).join("\n");
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>QuickLogin 更新记录</title><link>https://quicklogin.cqu.moe/changelog/</link><description>QuickLogin 内测更新</description><language>zh-cn</language>${entries.map(({ version, date, notes }) => `<item><title>QuickLogin ${version}</title><link>https://quicklogin.cqu.moe/changelog/#v${version}</link><guid isPermaLink="false">quicklogin-${version}</guid><pubDate>${new Date(date).toUTCString()}</pubDate><description>${escape(notes.join("\n"))}</description></item>`).join("")}</channel></rss>`;
  return { html, rss };
}
