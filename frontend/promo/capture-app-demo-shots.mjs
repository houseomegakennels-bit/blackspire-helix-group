import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = path.join(__dirname, "shots");

await mkdir(shotDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--hide-scrollbars"],
});

const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

const pages = [
  { name: "dashboard", url: "http://localhost:3000/" },
  { name: "new-search", url: "http://localhost:3000/searches/new" },
  { name: "searches", url: "http://localhost:3000/searches" },
  { name: "buyers", url: "http://localhost:3000/buyers" },
  { name: "workflows", url: "http://localhost:3000/workflows" },
];

for (const item of pages) {
  const page = await context.newPage();
  await page.goto(item.url, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(shotDir, `${item.name}.png`),
    fullPage: false,
  });
  await page.close();
}

await context.close();
await browser.close();
