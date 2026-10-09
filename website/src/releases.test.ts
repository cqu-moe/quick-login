import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { releaseContent } from "../releases";
const folders: string[] = [];
function notes(records: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "quicklogin-notes-")); folders.push(folder);
  for (const [version, body] of Object.entries(records)) writeFileSync(join(folder, `${version}.md`), body);
  return folder;
}
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));
it("publishes the same newest-first escaped notes in HTML and RSS", () => {
  const result = releaseContent(notes({ "0.4.9": "Date: 2026-10-08\n- Older fix", "0.4.10": "Date: 2026-10-09\n- <script> & fix" }), "0.4.10");
  const html = new DOMParser().parseFromString(result.html, "text/html");
  expect([...html.querySelectorAll('article')].map(node => node.id)).toEqual(['v0.4.10', 'v0.4.9']);
  expect(html.querySelector('li')?.textContent).toBe('<script> & fix');
  expect(html.querySelector('script')).toBeNull();
  const rss = new DOMParser().parseFromString(result.rss, "application/xml");
  expect(rss.querySelector('parsererror')).toBeNull();
  expect(rss.querySelector('item description')?.textContent).toBe('<script> & fix');
  expect(rss.querySelector('item link')?.textContent).toBe('https://quicklogin.cqu.moe/changelog/#v0.4.10');
});
it("blocks missing current-version notes and invalid publication dates", () => {
  expect(() => releaseContent(notes({ '0.4.0': 'Date: 2026-10-09\n- Fix' }), '0.4.1')).toThrow();
  expect(() => releaseContent(notes({ '0.4.1': 'Date: 2026-02-30\n- Fix' }), '0.4.1')).toThrow();
});
