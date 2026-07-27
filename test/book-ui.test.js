import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SPEAKING_TIPS } from "../speaking-tips.js";

const source = await readFile(new URL("../book.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../book.css", import.meta.url), "utf8");
const sharedTipStyles = await readFile(new URL("../speaking-tip-card.css", import.meta.url), "utf8");
const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("Book renders tips first and skips redundant returning-member requests", () => {
  assert.match(source, /render\(\);\s*initialize\(\);/);
  assert.match(source, /if \(state\.memberId\)[\s\S]*await loadDashboard\(false\);[\s\S]*return;/);
  assert.match(source, /if \(error\.code !== "MEMBER_NOT_FOUND"\) throw error;/);
});

test("Book only loads its route stylesheet", () => {
  assert.match(source, /^import "\.\/book\.css";/);
  assert.doesNotMatch(entry, /styles\.css/);
  assert.doesNotMatch(index, /href="\/styles\.css"/);
});

test("the member menu only keeps logout", () => {
  assert.doesNotMatch(source, /data-switch-member|切换会员/);
  assert.match(source, /<div><button type="button" data-logout>退出<\/button><\/div>/);
});

test("every Book mutation routes through the shared loading tips", () => {
  assert.match(source, /const scope = form \|\| document\.querySelector\("#book-sheet\[open\] \.book-sheet-body"\)/);
  assert.match(source, /form\?\.querySelector\('\[type="submit"\]'\) \|\| scope\.querySelector\("\[data-confirm-cancel\], \[data-confirm-transfer\]"\)/);
  assert.match(source, /if \(!inlineLoading\) \{ state\.loading = true; render\(\); \}/);
  for (const action of ["save-goal", "book", "update-speech", "delete-goal", "restore-goal", "cancel", "transfer"]) {
    assert.match(source, new RegExp(`runAction\\("${action}"`));
  }
});

test("loading tips use a three-dot sticky note with peel transitions", () => {
  assert.equal(SPEAKING_TIPS.length, 12);
  assert.match(source, /createSpeakingTipCarousel/);
  assert.match(source, /speakingTips\.markup\(\)/);
  assert.doesNotMatch(source, /向左 \/ 向右滑动切换|book-loading-tip-nav|TIP_CARD_PROTOTYPE|PROTOTYPE · A/);
  assert.match(source, /speakingTips\.handleClick\(event\)/);
  assert.match(source, /speakingTips\.handleTouchStart\(event\)/);
  assert.match(source, /speakingTips\.handleTouchEnd\(event\)/);
  assert.match(source, /import "\.\/speaking-tip-card\.css"/);
  assert.doesNotMatch(styles, /\.book-loading-tip/);
  assert.match(sharedTipStyles, /\.speaking-tip-card\s*\{[\s\S]*background: #fff19a;[\s\S]*touch-action: pan-y;[\s\S]*rotate\(-\.6deg\)/);
  assert.match(sharedTipStyles, /min-height: 140px;[\s\S]*padding: 12px 16px 8px;/);
  assert.match(sharedTipStyles, /\.speaking-tip-dots button,[\s\S]*width: 24px;[\s\S]*height: 24px;/);
});

test("Book drawers constrain native controls on narrow screens", () => {
  assert.match(styles, /\.book-form input[\s\S]*min-width: 0;[\s\S]*max-width: 100%;/);
  assert.match(styles, /\.book-sheet-body, \.book-sheet-body > \*[\s\S]*min-width: 0; max-width: 100%;/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*\.book-sheet-actions \.book-button/);
  assert.match(source, /const passcode = new FormData\(form\)\.get\("passcode"\);[\s\S]*setSyncBusy\(form, true\)/);
});

test("speech editor keeps loading tips and save actions in one visible dock", () => {
  assert.match(source, /data-speech-form[\s\S]*book-submit-dock[\s\S]*book-sync-stage[\s\S]*book-sheet-actions/);
  assert.match(source, /const stage = scope\.querySelector\("\[data-sync-stage\]"\)[\s\S]*stage\.innerHTML = speakingTips\.markup\(\)/);
  assert.match(styles, /\[data-speech-fields\] \{ display: grid; gap: 20px; \}/);
  assert.match(styles, /\.book-submit-dock \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
  assert.match(styles, /\.book-sync-stage:empty \{ display: none; \}/);
});

test("role details come from the dashboard catalog", () => {
  assert.doesNotMatch(source, /const roleDescriptions =/);
  assert.match(source, /state\.dashboard\.roleCatalog\.find/);
  assert.match(source, /roleInfo\?\.roleUrl/);
  assert.match(source, /roleInfo\?\.sopUrl/);
});

test("future reservations expose RoleCatalog SOP as a separate safe link", () => {
  assert.match(source, /function renderReservation[\s\S]*roleCatalog\.find[\s\S]*查看角色 SOP ↗/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  assert.match(styles, /\.book-reservation > button[\s\S]*\.book-reservation > a/);
});

test("prepared speakers use the Base-backed Pathways cascade", () => {
  assert.match(source, /apiJson\("\/api\/pathways-catalog\?audience=book"\)/);
  assert.equal(source.match(/speechFields\(memberSpeechDefaults\(/g)?.length, 2);
  assert.match(source, /Speech title（演讲标题）<input name="session" maxlength="200"/);
  for (const field of ["pathwaysMode", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "pathwaysFormId"]) {
    assert.match(source, new RegExp(`name="${field}"`));
  }
  assert.match(source, /Official speech purpose/);
  assert.match(source, /readonly/);
  assert.match(source, /Custom speech objective/);
  assert.match(source, /Decide later/);
  assert.doesNotMatch(source, /name="pathwaysProject"/);
});

test("speech type uses a three-position control and only asks for meaningful variants", () => {
  assert.match(source, /book-speech-modes mode-\$\{mode \|\| "later"\}[\s\S]*type="radio"[\s\S]*Learning path[\s\S]*Custom[\s\S]*Decide later/);
  assert.match(source, /forms\.length === 1[\s\S]*type="hidden" name="pathwaysFormId"[\s\S]*Speech variant/);
  assert.match(source, /book-path-level[\s\S]*name="pathwaysPath"[\s\S]*name="pathwaysLevel"/);
  assert.match(styles, /\.book-speech-modes::before[\s\S]*background: var\(--book-blue\)[\s\S]*transition: transform/);
  assert.match(styles, /\.book-path-level \{[\s\S]*grid-template-columns:/);
});
