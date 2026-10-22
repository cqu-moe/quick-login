import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const root = resolve("website/dist");

async function publicFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`website output contains symlink: ${relative}`);
    if (entry.isDirectory()) result.push(...await publicFiles(new URL(`${entry.name}/`, directory), relative));
    else result.push(relative);
  }
  return result;
}

for (const name of await publicFiles(new URL("../website/dist/", import.meta.url))) {
  if (/\.map$|(^|\/)\.env|\.pem$|\.key$/i.test(name)) {
    throw new Error(`forbidden website artifact file: ${name}`);
  }
  const content = await readFile(new URL(name, new URL("../website/dist/", import.meta.url)));
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|client_secret|sourceMappingURL=/i.test(content)) {
    throw new Error(`forbidden website artifact content: ${name}`);
  }
}

const pages = [
  "index.html",
  "popup-preview.html",
  "download/index.html",
  "faq/index.html",
  "privacy/index.html",
  "changelog/index.html",
  "404.html",
];
for (const page of pages) {
  const source = await readFile(resolve(root, page), "utf8");
  const document = new JSDOM(source).window.document;
  assert.equal(
    document.querySelectorAll("h1").length,
    1,
    `${page}: needs one h1`,
  );
  assert.ok(
    document.querySelector('html[lang="zh-CN"]'),
    `${page}: missing language`,
  );
  assert.ok(!source.includes("<!-- header -->"), `${page}: missing navigation`);
  for (const node of document.querySelectorAll("[href], [src]")) {
    const target = node.getAttribute("href") ?? node.getAttribute("src");
    if (!target || /^(https?:|data:|mailto:)/.test(target)) continue;
    const url = new URL(target, `https://quicklogin.cqu.moe/${page}`);
    const path = resolve(
      root,
      `.${url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname}`,
    );
    assert.ok(path.startsWith(`${root}/`), "link escapes website");
    await stat(path);
    if (url.hash) {
      const linked = new JSDOM(await readFile(path, "utf8")).window.document;
      assert.ok(
        linked.getElementById(decodeURIComponent(url.hash.slice(1))),
        `${page}: missing ${target}`,
      );
    }
  }
}
console.log(
  `website ok: ${pages.length} pages, navigation and local assets verified`,
);

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const changelog = new JSDOM(await readFile(resolve(root, "changelog/index.html"), "utf8")).window.document;
const feed = new JSDOM(await readFile(resolve(root, "changelog/rss.xml"), "utf8"), { contentType: "application/xml" }).window.document;
assert.equal(changelog.querySelector("article")?.id, `v${version}`, "Changelog must include current version first");
assert.equal(feed.querySelector("item guid")?.textContent, `quicklogin-${version}`, "RSS must include current version first");
assert.equal(feed.querySelector("item description")?.textContent, [...changelog.querySelectorAll("article:first-of-type li")].map(node => node.textContent).join("\n"), "RSS and changelog notes must agree");
