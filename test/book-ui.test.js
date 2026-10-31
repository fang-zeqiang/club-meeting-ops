import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SPEAKING_TIPS } from "../speaking-tips.js";

const source = await readFile(new URL("../book.js", import.meta.url), "utf8");
const bookState = await readFile(new URL("../src/book/state.js", import.meta.url), "utf8");
const bookRender = await readFile(new URL("../src/book/render.js", import.meta.url), "utf8");
const bookSheets = await readFile(new URL("../src/book/sheets.js", import.meta.url), "utf8");
const bookActions = await readFile(new URL("../src/book/actions.js", import.meta.url), "utf8");
const bookEvents = await readFile(new URL("../src/book/events.js", import.meta.url), "utf8");
const bookMemberSwitch = await readFile(new URL("../src/book/member-switch.js", import.meta.url), "utf8");
// 「Book 里任何地方都不许出现」的反向断言仍需覆盖拆分前 book.js 的全部文本
const bookAll = [source, bookState, bookRender, bookSheets, bookActions, bookEvents, bookMemberSwitch].join("\n");
const styles = await readFile(new URL("../book.css", import.meta.url), "utf8");
const sharedTipStyles = await readFile(new URL("../speaking-tip-card.css", import.meta.url), "utf8");
const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("Book renders tips first and skips redundant returning-member requests", () => {
  assert.match(source, /render\(\);\s*initialize\(\);/);
  assert.match(bookActions, /if \(state\.memberId\)[\s\S]*await loadDashboard\(false\);[\s\S]*return;/);
  assert.match(bookActions, /if \(error\.code !== "MEMBER_NOT_FOUND"\) throw error;/);
});

test("Book only loads its route stylesheet", () => {
  assert.match(source, /^import "\.\/book\.css";/);
  assert.doesNotMatch(entry, /styles\.css/);
  assert.doesNotMatch(index, /href="\/styles\.css"/);
});

test("the member menu only keeps logout", () => {
  // 「切换会员」按钮仍不得回到菜单里；长按快速切换是另一条入口，所以只禁按钮，不再禁中文短语。
  assert.doesNotMatch(bookAll, /data-switch-member[^-]/);
  assert.match(bookRender, /BOOK_DEMO_MODE \? [\s\S]*data-switch-demo-member[\s\S]*: '<button type="button" data-logout>退出<\/button>'/);
});

test("every Book mutation routes through the shared loading tips", () => {
  assert.match(bookActions, /const scope = form \|\| document\.querySelector\("#book-sheet\[open\] \.book-sheet-body"\)/);
  assert.match(bookActions, /form\?\.querySelector\('\[type="submit"\]'\) \|\| scope\.querySelector\("\[data-confirm-cancel\], \[data-confirm-transfer\]"\)/);
  assert.match(bookActions, /if \(!inlineLoading\) \{ state\.loading = true; render\(\); \}/);
  for (const action of ["save-goal", "book", "update-speech", "update-presentation-url", "delete-goal", "restore-goal", "cancel", "transfer"]) {
    assert.match(bookEvents, new RegExp(`runAction\\("${action}"`));
  }
});

test("prepared speakers and TTM share strong presentation-link validation", () => {
  assert.match(bookSheets, /role === "Prepared Speaker" \|\| role === "TTM"/);
  assert.match(bookSheets, /data-external-presentation-url/);
  assert.match(bookSheets, /externalPresentationUrlError/);
  assert.match(bookEvents, /form\.reportValidity\(\)/);
  assert.match(bookSheets, /维护 Presentation 链接/);
  assert.match(bookSheets, /互联网任何人可查看/);
  assert.match(styles, /\.book-presentation-url-field input\[aria-invalid="true"\]/);
});

test("loading tips use a three-dot sticky note with peel transitions", () => {
  assert.equal(SPEAKING_TIPS.length, 12);
  assert.match(bookState, /createSpeakingTipCarousel/);
  assert.match(bookRender, /speakingTips\.markup\(\)/);
  assert.doesNotMatch(bookAll, /向左 \/ 向右滑动切换|book-loading-tip-nav|TIP_CARD_PROTOTYPE|PROTOTYPE · A/);
  assert.match(bookEvents, /speakingTips\.handleClick\(event\)/);
  assert.match(bookEvents, /speakingTips\.handleTouchStart\(event\)/);
  assert.match(bookEvents, /speakingTips\.handleTouchEnd\(event\)/);
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
  assert.match(bookEvents, /const passcode = new FormData\(form\)\.get\("passcode"\);[\s\S]*setSyncBusy\(form, true\)/);
});

test("speech editor keeps loading tips and save actions in one visible dock", () => {
  assert.match(bookSheets, /data-speech-form[\s\S]*book-submit-dock[\s\S]*book-sync-stage[\s\S]*book-sheet-actions/);
  assert.match(bookActions, /const stage = scope\.querySelector\("\[data-sync-stage\]"\)[\s\S]*stage\.innerHTML = speakingTips\.markup\(\)/);
  assert.match(styles, /\[data-speech-fields\] \{ display: grid; gap: 20px; \}/);
  assert.match(styles, /\.book-submit-dock \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
  assert.match(styles, /\.book-sync-stage:empty \{ display: none; \}/);
});

test("role details come from the dashboard catalog", () => {
  assert.doesNotMatch(bookAll, /const roleDescriptions =/);
  assert.match(bookRender, /state\.dashboard\.roleCatalog\.find/);
  assert.match(bookEvents, /roleInfo\?\.roleUrl/);
  assert.match(bookEvents, /roleInfo\?\.sopUrl/);
});

test("meeting summaries expose Sharing Master confirmation at the outer level", () => {
  assert.match(bookRender, /const sharingGuest = sharingGuestStatus\(meeting\.sharingGuest\)/);
  assert.match(bookRender, /function sharingGuestStatus\(master\)/);
  assert.match(bookRender, /label: "已确认", memberName: master\.memberName/);
  assert.match(bookRender, /label: "待确认", memberName: ""/);
  assert.match(bookRender, /if \(!master\) return \{ state: "none", label: "无分享嘉宾", memberName: "" \}/);
  assert.match(bookRender, /function renderSharingGuestStatus\(status\)/);
  assert.match(bookRender, /renderSharingGuestStatus\(sharingGuest\)/);
  assert.match(styles, /\.book-sharing-status\.confirmed[\s\S]*var\(--book-green-soft\)/);
  assert.match(styles, /\.book-sharing-status\.pending[\s\S]*#fff1df/);
  assert.match(styles, /\.book-sharing-status\.none[\s\S]*#eef2f6/);
  assert.match(styles, /@media \(max-width: 460px\)[\s\S]*\.book-sharing-status > small/);
});

test("future reservations expose RoleCatalog SOP as a separate safe link", () => {
  assert.match(bookRender, /function renderReservation[\s\S]*roleCatalog\.find[\s\S]*查看角色 SOP ↗/);
  assert.match(bookRender, /target="_blank" rel="noopener noreferrer"/);
  assert.match(styles, /\.book-reservation > button[\s\S]*\.book-reservation > a/);
});

test("reservation history renders read-only role and Pathways details", () => {
  assert.match(bookRender, /id="reservation-history-heading">历史预约/);
  assert.match(bookRender, /historyReservations \|\| \[\]/);
  assert.match(bookRender, /renderHistoricalReservation/);
  assert.match(bookRender, /pathwaysCatalog\?\.projects\.find/);
  for (const detail of ["session", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "speechObjective", "legacyProject"]) {
    assert.match(bookRender, new RegExp(`details\\.${detail}`));
  }
  assert.match(bookRender, /<article class="book-reservation book-reservation-history">/);
  assert.match(styles, /\.book-history-details/);
  assert.match(styles, /\.book-reservation-history > \.book-date \{ align-content: start; align-self: start; \}/);
});

test("meeting tab renders read-only history meetings with Pathways and safe presentation links", () => {
  assert.match(bookRender, /id="meeting-history-heading">历史会议/);
  assert.match(bookRender, /state\.dashboard\.historyMeetings \|\| \[\]/);
  assert.match(bookRender, /renderMeetingGroups\(historyMeetings, \{ historical: true \}\)/);
  assert.match(bookRender, /renderMeeting\(meeting, \{ historical \}\)/);
  assert.match(bookRender, /renderHistoricalSpeechDetails\(assignment\.speechDetails\)/);
  assert.match(bookRender, /\^https\?:\\\/\\\//);
  assert.match(bookRender, /查看 Presentation ↗/);
  assert.match(bookRender, /target="_blank" rel="noopener noreferrer"/);
  assert.match(bookRender, /historical \? assignment\.status === "vacant" \? "空缺" : "已预约"/);
  assert.match(styles, /\.book-role-row\.history/);
});

test("prepared speakers use the Base-backed Pathways cascade", () => {
  assert.match(bookActions, /apiJson\("\/api\/pathways-catalog\?audience=book"\)/);
  assert.equal(bookSheets.match(/speechFields\(memberSpeechDefaults\(/g)?.length, 2);
  assert.match(bookSheets, /Speech title（演讲标题）<input name="session" maxlength="200"/);
  for (const field of ["pathwaysMode", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "pathwaysFormId"]) {
    assert.match(bookSheets, new RegExp(`name="${field}"`));
  }
  assert.match(bookSheets, /Official speech purpose/);
  assert.match(bookSheets, /readonly/);
  assert.match(bookSheets, /Custom speech objective/);
  assert.match(bookSheets, /Decide later/);
  assert.doesNotMatch(bookAll, /name="pathwaysProject"/);
});

test("speech type uses a three-position control and only asks for meaningful variants", () => {
  assert.match(bookSheets, /book-speech-modes mode-\$\{mode \|\| "later"\}[\s\S]*type="radio"[\s\S]*Pathways[\s\S]*Custom[\s\S]*Decide later/);
  assert.match(bookSheets, /forms\.length === 1[\s\S]*type="hidden" name="pathwaysFormId"[\s\S]*Speech variant/);
  assert.match(bookSheets, /book-path-level[\s\S]*name="pathwaysPath"[\s\S]*name="pathwaysLevel"/);
  assert.match(styles, /\.book-speech-modes::before[\s\S]*background: var\(--book-blue\)[\s\S]*transition: transform/);
  assert.match(styles, /\.book-path-level \{[\s\S]*grid-template-columns:/);
});

test("Book exposes the approved Guest booking and shared-management flow", () => {
  assert.match(bookSheets, /assignment\.guestBookable[\s\S]*预约给自己[\s\S]*帮 Guest 预约/);
  assert.match(bookSheets, /data-guest-search[\s\S]*data-new-booking-guest/);
  assert.match(bookSheets, /book-guest-ticket/);
  assert.match(bookSheets, /data-guest-booking-form[\s\S]*book-guest-warnings[\s\S]*book-guest-summary/);
  assert.match(bookSheets, /我已获得 Guest 同意，并会线下转达预约结果/);
  assert.match(bookRender, /assignment\.guest[\s\S]*book-guest-pass/);
  assert.match(bookSheets, /data-transfer-guest-role/);
  assert.match(bookEvents, /runAction\(transfer \? "transfer" : "book-guest"/);
  assert.match(styles, /\.book-role-row\.guest[\s\S]*var\(--book-coral-soft\)/);
  assert.match(styles, /\.book-guest-ticket[\s\S]*writing-mode: vertical-rl/);
  assert.match(styles, /@media \(max-width: 460px\)/);
});

test("TTM manages Table Topics through a full load, add, delete, error cycle with accessible states", () => {
  assert.match(bookRender, /data-manage-topics="\$\{esc\(meeting\.id\)\}"/);
  assert.match(bookRender, /assignment\.mine && assignment\.role === "TTM" && meeting\.status === "draft"/);
  assert.match(bookSheets, /async function openTopicsSheet\(meetingId\)[\s\S]*action=table-topics/);
  assert.match(bookEvents, /data-topic-form[\s\S]*action=table-topic-add/);
  assert.match(bookEvents, /data-delete-topic[\s\S]*action=table-topic-delete/);
  assert.match(bookSheets, /aria-label="删除话题：\$\{esc\(topic\.topicText\)\}"/);
  assert.match(bookSheets, /book-topic-list-hint">左滑话题可删除<\/p>\$\{previewLink\(meeting\)\}<\/div><ul class="book-topic-list"[\s\S]*data-topic-swipe[\s\S]*book-swipe-delete/);
  assert.match(bookSheets, /function previewLink\(meeting\)[\s\S]*book-topic-preview" href="\$\{esc\(href\)\}" target="_blank" rel="noopener">预览 Presentation 效果/);
  assert.doesNotMatch(bookSheets, /book-button danger compact" type="button" data-delete-topic/);
  assert.match(bookEvents, /\[data-goal-swipe\], \[data-topic-swipe\]/);
  assert.match(styles, /\.book-topic-swipe\.revealed \.book-topic-row \{ transform: translateX\(-84px\); \}/);
  assert.match(bookSheets, /book-topic-empty" role="status">正在加载/);
  assert.match(bookSheets, /book-warning" role="alert">\$\{esc\(sheet\.error\)\}/);
  assert.match(styles, /\.book-topic-list[\s\S]*\.book-topic-row/);
});

test("TTM batch topic entry splits lines and links to the meeting's Presentation page", () => {
  assert.match(bookEvents, /topicText[\s\S]*split\("\\n"\)[\s\S]*topicTexts/);
  assert.match(bookSheets, /textarea name="topicText"[\s\S]*一行一条可批量录入/);
  assert.match(bookSheets, /book-topic-success" role="status">已录入 \$\{sheet\.added\} 条话题<\/p>/);
  assert.match(styles, /\.book-topic-success/);
});

test("long-pressing the header member opens a drag-to-pick switcher", () => {
  assert.match(bookRender, /<summary data-member-longpress title="长按可上下切换会员">/);
  assert.match(bookEvents, /bindMemberQuickSwitch\(root\)/);
  assert.match(bookMemberSwitch, /LONG_PRESS_MS = 500[\s\S]*MOVE_CANCEL_PX = 10/);
  assert.match(bookMemberSwitch, /pointerdown[\s\S]*setTimeout[\s\S]*openOverlay/);
  assert.match(bookMemberSwitch, /pointerup[\s\S]*selectedId !== state\.memberId\) await selectMember\(selectedId\)/);
  assert.match(bookMemberSwitch, /book-member-switch-tip">上下拖动选择，松手切换/);
  assert.match(styles, /\.book-member-switch-option\[aria-selected="true"\] \{ color: #fff; background: var\(--book-blue\); \}/);
  assert.match(styles, /\.book-member-menu > summary \{[^}]*touch-action: none;/);
});

test("renderRole links to a jump-scoped presentation preview for the speaker's own Prepared Speaker row", () => {
  assert.match(bookRender, /presentationPreviewUrl\(meeting\.meetingNumber, "ps", order\)/);
});

test("previewLink for table topics uses the shared presentationPreviewUrl helper", () => {
  assert.match(bookSheets, /presentationPreviewUrl\(meeting\?\.meetingNumber, "tabletopics"\)/);
});
