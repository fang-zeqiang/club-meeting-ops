import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { derivePresentationSlides, isAwardsItem, isTableTopicsItem, isVoteItem } from "../meeting-presentation-model.js";

const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");
const source = await readFile(new URL("../meeting-presentation.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../meeting-presentation.css", import.meta.url), "utf8");
const themeStyles = await readFile(new URL("../meeting-presentation-themes.css", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../temporary-text-editor.js", import.meta.url), "utf8");
const vercelConfig = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
const remotePageSource = await readFile(new URL("../presentation-remote-page.js", import.meta.url), "utf8");
const remoteCss = await readFile(new URL("../presentation-remote.css", import.meta.url), "utf8");

const meeting = {
  id: "meeting_99",
  meetingNumber: 99,
  date: "2026-07-08",
  theme: "Practice makes a difference",
  qrSource: "system",
  blocks: [
    {
      title: "Opening Session",
      items: [
        { kind: "role", session: "Warm-up", role: "Warm-up Host", member: "Taylor LEE" },
        { kind: "role", session: "Presidential Opening", role: "President", member: "Alex CHEN" },
        { kind: "role", session: "Today's Program", role: "TME", member: "Taylor LEE" },
      ],
    },
    {
      title: "Prepared Speech",
      items: [
        { kind: "speech", session: "The Pizza Moment", role: "Prepared Speaker", member: "Morgan PARK", evaluator: "Casey KIM", speechObjective: "Make people laugh" },
        { kind: "break", session: "Break", duration: 5, member: "Should not show" },
      ],
    },
    {
      title: "Closing Session",
      items: [
        { kind: "role", session: "Awards", role: "President", member: "Alex CHEN" },
      ],
    },
  ],
};

test("meeting presentation has a dedicated public read-only route", () => {
  assert.match(entry, /meetings.*presentation/);
  assert.match(entry, /shortMeetingPresentationRoute/);
  assert.match(entry, /posterPresentationRoute/);
  assert.match(vercelConfig, /\/meetings\/:id\/presentation/);
  assert.match(vercelConfig, /\/m\/:number\/presentation/);
  assert.match(vercelConfig, /\/m\/:number\/posters/);
  assert.match(vercelConfig, /\/posters/);
  assert.match(source, /api\/meetings\/\$\{encodeURIComponent\(meetingId\)\}\?view=presentation/);
  assert.match(source, /action=system-image&view=presentation/);
  assert.match(source, /images\/voting\?view=presentation/);
  assert.match(source, /awards\?view=ceremony/);
  assert.match(entry, /location\.replace/);
  assert.doesNotMatch(source, /Sign in to Agenda/);
  assert.match(entry, /jump=awards/);
});

test("phone remote has a dedicated route ahead of Presentation", () => {
  assert.match(entry, /presentation\/remote/);
  assert.ok(entry.indexOf("const presentationRemoteRoute") < entry.indexOf("const shortMeetingPresentationRoute"));
  assert.match(entry, /else if \(presentationRemoteRoute\) \{\s+import\("\.\/presentation-remote-page\.js"\);\s+\} else if \(meetingPresentationRoute \|\| shortMeetingPresentationRoute/);
  assert.match(vercelConfig, /\/m\/:number\/presentation\/remote/);
  assert.match(remotePageSource, /location\.hash\.slice\(1\)/);
  assert.match(remotePageSource, /button\("draw-topic", state\.drawTopicMode === "redraw" \? "换一题（需按两次）" : "抽取话题"/);
  assert.match(remotePageSource, /publishCommand\("go-to"/);
  assert.match(remotePageSource, /button\("refresh-awards", "刷新奖项"/);
  assert.doesNotMatch(remotePageSource, /open-award|return-to-presentation/);
  assert.match(remoteCss, /min-height: 44px/);
  assert.doesNotMatch(remotePageSource, /SUPABASE.*SECRET|service_role|sb_secret/);
});

test("slide derivation follows the agreed agenda presentation structure", () => {
  const slides = derivePresentationSlides(meeting, { awardPageUrl: "/meetings/meeting_99/awards/present" });
  assert.deepEqual(slides.slice(0, 8).map((slide) => slide.type), ["cover", "item", "item", "practice-intro", "club-intro", "item", "program", "speech"]);
  assert.deepEqual(slides.slice(1, 7).map((slide) => slide.title || slide.type), ["Warm-up", "Presidential Opening", "practice-intro", "club-intro", "Today's Program", "program"]);
  assert.equal(slides[5].member, "Taylor LEE");
  assert.equal(slides.at(-1).type, "thanks");
  assert.ok(slides.find((slide) => slide.type === "vote"), "missing inserted vote slide");
  assert.ok(slides.findIndex((slide) => slide.type === "vote") < slides.findIndex((slide) => slide.type === "awards"));
  assert.equal(slides.find((slide) => slide.type === "speech").role, "");
  assert.equal(slides.find((slide) => slide.type === "speech").evaluator, "Casey KIM");
  assert.deepEqual(
    Object.fromEntries(Object.entries(slides.find((slide) => slide.type === "break")).filter(([key]) => ["title", "duration", "member"].includes(key))),
    { title: "Break", duration: 5, member: "" },
  );
  assert.deepEqual(slides.find((slide) => slide.type === "program").blocks[1].items[1], { kind: "break", session: "Break", member: "" });
});

test("Table Topics session item becomes its own presentation slide type", () => {
  assert.equal(isTableTopicsItem({ kind: "role", role: "TTM" }), true);
  assert.equal(isTableTopicsItem({ kind: "role", role: "Table Topics Master" }), false);
  assert.equal(isTableTopicsItem({ kind: "speech", role: "TTM" }), false);
  assert.equal(isTableTopicsItem({ kind: "role", role: "Timer" }), false);
  const withTtm = {
    ...meeting,
    blocks: [...meeting.blocks, { title: "Table Topics Session", items: [{ kind: "role", session: "Table Topics Session", role: "TTM", member: "Robin ZHAO", duration: 15 }] }],
  };
  const slides = derivePresentationSlides(withTtm, { tableTopicsTotal: 3 });
  const ttmSlide = slides.find((slide) => slide.type === "tabletopics");
  assert.ok(ttmSlide, "missing tabletopics slide");
  assert.equal(ttmSlide.member, "Robin ZHAO");
  const ttmIndex = slides.indexOf(ttmSlide);
  assert.equal(slides[ttmIndex + 1].type, "tabletopics-draw");
  assert.equal(slides[ttmIndex + 1].key, `${ttmSlide.key}:draw`);
  assert.ok(slides.every((slide) => slide.type !== "tabletopics-wall"), "Speakers 名单墙已被抽题页左侧名单取代");
  assert.equal(ttmSlide.duration, 0);
  assert.equal(slides[ttmIndex + 1].duration, 15);
});

test("Grammarian Intro renders a fixed two-column Word training card", () => {
  assert.match(source, /function grammarianIntro\(slide\)/);
  assert.match(source, /class="grammarian-intro-layout"/);
  assert.match(source, /renderWordTrainingCard\(slide.wordOfDay\)/);
  assert.match(source, /if \(slide\.type === "grammarian-intro"\) return grammarianIntro\(slide\);/);
  assert.match(styles, /\.grammarian-intro-layout[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});

test("active Word of the Day uses the watermark outline treatment", () => {
  assert.match(source, /data-word-reminder/);
  assert.match(source, /WORD OF THE DAY/);
  // WOD 显隐只由页面位置决定（Grammarian Intro 之后直到最后一页），前进、后退、跳页结果一致
  assert.match(source, /toggleAttribute\("hidden", !isWordReminderVisible\(deck\.slides, index\)\)/);
  assert.doesNotMatch(source, /wordReminderState|activateWordReminder/);
  assert.match(styles, /\.word-reminder-card[\s\S]*right: 4%/);
  // 水印式：无底色卡片，单词为跟随主题的空心描边字
  assert.doesNotMatch(styles, /\.word-reminder-card \{[^}]*background:/);
  assert.match(styles, /\.word-reminder-card strong \{[^}]*color: transparent;[^}]*-webkit-text-stroke: 1\.5px color-mix\(in srgb, var\(--pres-heading\) 55%, transparent\)/);
  // 卡片自身 display 会覆盖 hidden 属性，必须显式隐藏
  assert.match(styles, /\.word-reminder-card\[hidden\] \{ display: none; \}/);
});

test("Table Topics live data polls only while a live-dependent slide is active", () => {
  assert.match(source, /TABLE_TOPICS_LIVE_POLL_MS = 3000/);
  assert.match(source, /function isTableTopicsLiveSlide\(slide\)/);
  assert.match(source, /view=table-topics-live/);
  assert.match(source, /window\.setInterval\(refreshTableTopicsLive, TABLE_TOPICS_LIVE_POLL_MS\)/);
});

test("Table Topics live views own the empty state and break no longer edits a legacy speaker list", () => {
  assert.match(source, /No timing records are available yet/);
  assert.match(source, /Use the Table Topics live panel to record speakers and update the voting form\./);
  assert.doesNotMatch(source, /data-break-speakers/);
  assert.doesNotMatch(source, /data-save-break-speakers/);
});

test("Table Topics draw includes a structured live panel for entries and current speaker", () => {
  assert.match(source, /data-tabletopics-live-panel/);
  assert.match(source, /data-tabletopics-entry-form/);
  assert.match(source, /data-current-tabletopics-entry/);
  assert.match(source, /data-tabletopics-duration/);
  assert.match(source, /action=table-topics-entries/);
  assert.match(styles, /\.tabletopics-live-panel \{[^}]*left: 3\.2%[^}]*width: 22%[^}]*border-right: 1px solid var\(--pres-badge-border\)/);
  // 左侧名单只做展示：无底框，不再提供第二个录入 Speaker 的表单
  assert.doesNotMatch(styles, /\.tabletopics-live-panel \{[^}]*background: var/);
  const panel = source.slice(source.indexOf("function tableTopicsLivePanel"), source.indexOf("function tableTopics(slide"));
  assert.doesNotMatch(panel, /<form/);
  // 讲台布局：右侧左对齐，上下各让出 22% 给品牌条 / WOD 与计时器
  assert.match(styles, /\.tabletopics-draw-copy \{[^}]*inset: 22% 10% 22% 31%[^}]*justify-items: start;[^}]*text-align: left;/);
});

test("Table Topics draw guides speaker entry first and makes next speaker the primary action after a topic", () => {
  assert.match(source, /class="tabletopics-next-form" data-tabletopics-entry-form/);
  assert.match(source, /"下一位 Speaker" : "第一位 Speaker"/);
  assert.match(source, /<button type="button" data-next-tabletopics-speaker>下一位 Speaker →<\/button>\$\{redraw\}/);
  assert.match(source, /class="tabletopics-secondary" data-draw-topic data-redraw data-speaker-name="\$\{escapeHtml\(speaker\.name\)\}">给 \$\{escapeHtml\(speaker\.name\)\} 换一题/);
  assert.match(source, /data-cancel-next-speaker>返回 \$\{escapeHtml\(current\.name\)\} 的话题/);
  assert.match(source, /drawnTopicsByEntry\.set\(context\.currentTableTopicsEntryId, \{ key: result\.key, text: result\.topicText \}\)/);
  // 换题需二次确认，本机点击与遥控共用 requestDrawTopic
  assert.match(source, /async function requestDrawTopic\(slideNode\) \{[\s\S]*?hasAttribute\("data-redraw"\) && !button\.hasAttribute\("data-confirming"\)[\s\S]*?3000\);/);
  assert.match(source, /if \(event\.target\.closest\("\[data-draw-topic\]"\)\) \{ await requestDrawTopic\(/);
  assert.match(source, /if \(command === "draw-topic"\) \{[\s\S]{0,60}?if \(canDrawTopicNow\(\)\) await requestDrawTopic\(slide\);/);
  assert.match(source, /querySelector\("\[data-draw-topic\]:not\(:disabled\)"\)/);
  assert.match(source, /drawTopicMode: nodes\[index\]\.querySelector\("\[data-draw-topic\]\[data-redraw\]"\) \? "redraw" : "draw"/);
  // 新增 Speaker 时由前端生成 id，一次写入即成为当前 Speaker
  assert.match(source, /const id = `tte_\$\{crypto\.randomUUID\(\)\}`;/);
  assert.match(source, /saveTableTopicsEntries\(\[\.\.\.context\.tableTopicsEntries, \{ id, name \}\], id, status\)/);
  assert.match(styles, /\.tabletopics-draw \.tabletopics-secondary\[data-confirming\]/);
});

test("saving Table Topics entries updates the draw slide in place instead of rebuilding the deck", () => {
  const save = source.slice(source.indexOf("async function saveTableTopicsEntries"), source.indexOf("const remoteCorner"));
  assert.match(save, /renderTableTopicsDrawSlides\(\{ panel \}\)/);
  assert.doesNotMatch(save, /renderDeck\(/);
  // mountDeck 与 renderDeck 是平级函数，共享状态必须在模块级声明
  assert.match(source, /^let context = \{\};$/m);
});

test("Table Topics draw is public, server-random, secret until drawn, and click-guard safe", () => {
  assert.match(source, /tableTopicsTotal = \(await apiJson\(`\/api\/meetings\/\$\{encodeURIComponent\(meeting\.id\)\}\?action=table-topics-remaining`\)/);
  assert.doesNotMatch(source, /if \(!context\.authenticated\) return "";/);
  assert.match(source, /TTM 尚未录入话题/);
  assert.match(source, /话题已抽完/);
  assert.match(source, /if \(event\.target\.closest\("\[data-draw-topic\]"\)\)/);
  assert.match(source, /async function drawTableTopic\(slideNode\)[\s\S]*action=draw-topic[\s\S]*excludeKeys: tableTopicsPool\(context\)\.excludeKeys/);
  assert.match(source, /drawnTopicKeys\.add\(result\.key\)/);
  assert.match(styles, /\.tabletopics-topic \{[\s\S]*opacity: 0/);
  assert.match(styles, /prefers-reduced-motion: reduce\)[\s\S]*\.tabletopics-topic[\s\S]*transition: none/);
  assert.equal((source.match(/data-tabletopics-status role="status"/g) || []).length, 4);
  assert.match(source, /data-tabletopics-topic role="status"/);
  assert.match(source, /function tableTopicsDraw\(slide, context\)/);
  assert.match(source, /function topicCharacters\(text\)/);
  assert.match(source, /return topicTokens\(text\)\.map\(/);
  assert.match(source, /class="tabletopics-word"/);
  assert.match(source, /class="tabletopics-character"/);
  assert.match(styles, /\.tabletopics-word \{ white-space: nowrap; \}/);
  assert.match(styles, /\.tabletopics-topic \.tabletopics-character \{ display: inline-block; opacity: 0; \}/);
  assert.match(styles, /@keyframes tabletopics-write/);
  assert.match(styles, /\.tabletopics-draw-copy[\s\S]*align-content: center/);
  assert.match(styles, /\.tabletopics-draw-copy:has\(\.tabletopics-speaker\) h1 \{\s*display: none;\s*\}/);
  assert.match(styles, /\.tabletopics-topic\.fit-medium \{/);
  assert.match(styles, /\.tabletopics-topic\.fit-long \{/);
});

test("future posters insert one optional slide immediately after voting", () => {
  const one = derivePresentationSlides(meeting, { futurePosters: ["/poster-1"] });
  const two = derivePresentationSlides(meeting, { futurePosters: ["/poster-1", "/poster-2"] });
  const voteIndex = one.findIndex((slide) => slide.type === "vote");
  assert.equal(one[voteIndex + 1].type, "future-posters");
  assert.deepEqual(one[voteIndex + 1].images, ["/poster-1"]);
  assert.deepEqual(two[two.findIndex((slide) => slide.type === "vote") + 1].images, ["/poster-1", "/poster-2"]);
});

test("sharing master award inserts one certificate slide immediately after the Sharing Session item", () => {
  const withSharing = structuredClone(meeting);
  withSharing.blocks[1].items.splice(1, 0, { kind: "role", session: "Sharing Session", role: "Sharing Master", member: "Blake" });
  const sharingMasterAward = {
    clubName: "DEMO SPEAKING CLUB",
    meetingNumber: 99,
    meetingDate: "2026-07-08",
    signatory: { name: "Jamie SONG" },
    award: { winners: [{ name: "Blake" }] },
  };
  const slides = derivePresentationSlides(withSharing, { sharingMasterAward });
  const sharingIndex = slides.findIndex((slide) => slide.title === "Sharing Session");
  assert.ok(sharingIndex >= 0, "missing Sharing Session slide");
  assert.equal(slides[sharingIndex + 1].type, "sharing-master-award");
  assert.deepEqual(slides[sharingIndex + 1].winners, ["Blake"]);
  assert.equal(slides[sharingIndex + 1].signatory.name, "Jamie SONG");
  assert.equal(derivePresentationSlides(withSharing).some((slide) => slide.type === "sharing-master-award"), false);
  assert.equal(derivePresentationSlides(meeting, { sharingMasterAward }).some((slide) => slide.type === "sharing-master-award"), false);
});

test("future poster preview mode loads only the poster slide and hides deck chrome", () => {
  assert.match(source, /Boolean\(posterRoute\) \|\| query\.get\("preview"\) === "future-posters"/);
  assert.match(source, /posterPreviewMode[\s\S]*slides: posters\[0\] \? \[\{ key: "future-posters", type: "future-posters", images: posters\.filter\(Boolean\) \}\] : \[\]/);
  assert.match(source, /posterPreviewMode \? "poster-preview" : ""/);
  assert.match(styles, /\.meeting-presentation\.poster-preview \.presentation-controls[\s\S]*display: none/);
});

test("external content inserts one interactive slide immediately after its agenda item", () => {
  const withExternal = structuredClone(meeting);
  withExternal.enableTransitionTime = true;
  withExternal.blocks[1].items[0].duration = 7;
  withExternal.blocks[1].items[0].externalPresentationUrl = "https://example.com/slides/demo";
  const slides = derivePresentationSlides(withExternal);
  const speechIndex = slides.findIndex((slide) => slide.type === "speech");
  assert.deepEqual(slides.slice(speechIndex, speechIndex + 2).map((slide) => slide.type), ["speech", "external-content"]);
  assert.deepEqual(slides[speechIndex + 1], {
    key: "item:Prepared Speech:The Pizza Moment:Prepared Speaker:external",
    type: "external-content",
    title: "The Pizza Moment",
    duration: 7,
    timerSignals: { green: 300, yellow: 360, red: 420, bell: 450 },
    transitionSeconds: 60,
    url: "https://example.com/slides/demo",
  });
});

test("external deck explains the in-page handoff and offers the next agenda item", () => {
  assert.match(source, /Present inside · Esc to return/);
  assert.match(source, /data-next-external[^>]*>[^<]*\$\{CONTROL_ICONS\.next\}<span>Next agenda item<\/span>/);
  assert.match(source, /document\.querySelector\("\[data-next-external\]"\)\.onclick = next/);
  assert.match(styles, /\.external-instructions/);
});

test("enabled transition time adds an automatic progress phase before session timing", () => {
  const withTransition = structuredClone(meeting);
  withTransition.enableTransitionTime = true;
  const timedSlides = derivePresentationSlides(withTransition).filter((slide) => slide.duration);
  assert.ok(derivePresentationSlides(meeting).filter((slide) => slide.duration).every((slide) => slide.transitionSeconds === 0));
  assert.ok(timedSlides.length > 0);
  assert.ok(timedSlides.every((slide) => slide.transitionSeconds === 60));
  assert.match(source, /data-phase="\$\{transitionSeconds \? "transition" : "session"\}"/);
  assert.match(source, /panel\.dataset\.phase === "transition"/);
  assert.match(source, /if \(autoStart && Number\(panel\?\.dataset\.transitionSeconds \|\| 0\)\) startTimer\(panel\)/);
  assert.match(source, /if \(panel\.dataset\.phase === "transition"\)[\s\S]*panel\.dataset\.phase = "session";[\s\S]*panel\.classList\.add\("transition-complete"\);[\s\S]*startTimer\(panel\)/);
  // Transition 与 session 共用同一个圆环进度条（无独立直线进度条元素/样式）
  assert.match(source, /const updateRing = \(panel\) => \{/);
  assert.doesNotMatch(source, /class="transition-progress"/);
  assert.doesNotMatch(styles, /\.transition-progress/);
});

test("presentation text editing is DOM-only, keyboard accessible, and plain text", () => {
  assert.match(source, /mountTemporaryTextEditor/);
  assert.match(source, /data-edit-text/);
  assert.match(source, /data-editable-text/);
  assert.match(source, /event\.target\.closest\("input, select, textarea, label, button, a, \[contenteditable\][^"]*\.tabletopics-live-panel"\)\) return;/);
  assert.match(styles, /\.text-editing \[data-editable-text\]/);
  assert.match(editorSource, /contenteditable", "plaintext-only"/);
  assert.match(editorSource, /clipboardData\.getData\("text\/plain"\)/);
  assert.doesNotMatch(editorSource, /\b(?:fetch|localStorage|sessionStorage)\b/);
});

test("presentation refresh, outline, and live Awards share one deck", () => {
  const slides = derivePresentationSlides(meeting);
  assert.equal(slides.find((slide) => slide.type === "awards").awardState, undefined);
  assert.ok(slides.every((slide) => slide.key));
  assert.match(source, /data-refresh-agenda/);
  assert.match(source, /Refresh deck/);
  assert.match(source, /data-external-controls/);
  assert.match(source, /External deck/);
  assert.match(source, /function controlIcon/);
  assert.match(source, /currentDeckState/);
  assert.match(source, /resume\.timerRemaining/);
  assert.match(source, /data-outline-index/);
  assert.match(source, /data-page-jump/);
  assert.match(source, /Use the Table Topics live panel to record speakers/);
  assert.doesNotMatch(source, /action=speakers/);
  assert.match(source, /AWARD_POLL_MS = 5000/);
  assert.match(source, /refreshAwardsNow/);
  assert.match(styles, /\.presentation-outline/);
  assert.match(styles, /\.break-voting-prompt/);
  assert.match(styles, /\.external-controls/);
});

test("mobile keeps slide navigation visible and moves secondary deck controls into More", () => {
  assert.match(source, /<details class="mobile-more-controls">/);
  assert.match(source, /aria-label="More presentation controls"/);
  assert.match(source, /data-refresh-agenda-mobile/);
  assert.match(source, /data-edit-text-mobile/);
  assert.match(source, /data-fullscreen-mobile/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*--control-size: 44px/);
  assert.match(styles, /\.mobile-more-controls\s*\{[\s\S]*display: block/);
  assert.match(styles, /bottom: max\(10px, env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.control-group\.external-controls\[hidden\]\s*\{\s*display: none;/);
});

test("vote and awards matching use item text, not block names", () => {
  assert.equal(isVoteItem({ session: "Vote & Announcement", role: "President" }), true);
  assert.equal(isVoteItem({ session: "Timer Report", role: "Timer" }), false);
  assert.equal(isAwardsItem({ session: "Awards", role: "President" }), true);
});

test("presentation styling stays visually separate from certificate awards", () => {
  assert.match(styles, /aspect-ratio: 16 \/ 9/);
  assert.match(source, /const clubBrandUrl = CLUB_PROFILE\.logo;/);
  assert.match(source, /const activeTheme = presentationTheme\(data\.meeting\);/);
  assert.match(source, /theme-\$\{activeTheme\}/);
  // 右边缘触发角切主题:只写 sessionStorage,不回写会议记录
  assert.match(source, /\.theme-trigger"\)\.onmouseenter/);
  assert.match(source, /sessionStorage\.setItem\(THEME_SESSION_KEY/);
  assert.doesNotMatch(source, /presentationTheme:[^\n]*applyPresentationTheme/);
  assert.match(themeStyles, /\.theme-swatch/);
  assert.match(themeStyles, /theme-sky/);
  assert.match(themeStyles, /theme-white/);
  assert.match(source, /Scan with WeChat/);
  assert.match(source, /futurePosterUrls/);
  assert.match(source, /presentationAssetUrl\("club-intro-photo"\)/);
  assert.match(source, /class="club-intro-photo"/);
  assert.match(styles, /\.club-intro-photo[\s\S]*width: 41%[\s\S]*height: auto[\s\S]*object-fit: contain/);
  assert.match(styles, /\.future-posters-layout\.single[\s\S]*justify-content: center/);
  assert.match(source, /class="future-poster-frame"/);
  assert.match(styles, /\.future-posters-layout[\s\S]*grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(styles, /\.future-poster-frame\s*\{[^}]*position: relative[^}]*height: 100%[^}]*min-width: 0[^}]*min-height: 0[^}]*overflow: hidden/s);
  assert.match(styles, /\.future-poster-frame img[\s\S]*position: absolute[\s\S]*inset: 0[\s\S]*width: 100%[\s\S]*height: 100%[\s\S]*object-fit: contain/);
  assert.match(source, /data-timer-start/);
  assert.match(source, /data-timer-display/);
  assert.match(source, /class="slide-timer \$\{signals/);
  assert.match(source, /data-external-frame/);
  assert.match(source, /data-refresh-external/);
  assert.match(source, /data-open-external/);
  assert.match(source, /allow-popups-to-escape-sandbox/);
  assert.match(styles, /\.external-content-stage iframe[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.doesNotMatch(source, /data-break-start/);
  assert.match(source, /program-break/);
  assert.match(source, /speech-main/);
  assert.match(source, /speech-meta/);
  assert.match(styles, /\.speech-copy \.speaker-line[\s\S]*8\.6cqh/);
  assert.match(styles, /\.speech-meta \.evaluator-line[\s\S]*2\.8cqh/);
  assert.match(styles, /#ffc000/);
  assert.match(source, /Press F/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /data-fullscreen aria-label="Enter fullscreen"[^>]*>\$\{CONTROL_ICONS\.fullscreen\}/);
  assert.match(styles, /@media \(hover: none\)[\s\S]*\.presentation-controls[\s\S]*opacity: \.96/);
});

test("sharing master certificate slide reuses the award ceremony's certificate look", () => {
  assert.match(styles, /\.certificate \{[\s\S]*aspect-ratio: 13 \/ 9/);
  assert.match(source, /function sharingMasterAward\(slide\)/);
  assert.match(source, /class="meeting-slide sharing-master-slide"/);
  assert.match(source, /if \(slide\.type === "sharing-master-award"\) return sharingMasterAward\(slide\);/);
  assert.match(source, /awards\?view=sharing-master/);
});

test("Presentation emits a QR remote and dispatches only permitted expanded commands", () => {
  assert.match(source, /data-remote-corner/);
  assert.match(source, /QRCode\.toDataURL/);
  assert.match(source, /remotePresentationUrl\(/);
  assert.match(source, /normalizeRemoteCommand\(value\)/);
  assert.match(source, /command === "draw-topic"/);
  assert.match(source, /command === "go-to"/);
  assert.match(source, /command === "refresh-awards"/);
  assert.match(source, /command === "reload-external"/);
  assert.match(source, /canRefreshAwards/);
  assert.match(source, /remote\.publishState\(/);
  assert.doesNotMatch(source, /VITE_SUPABASE.*SECRET|sb_secret/);
});

test("the remote QR badge stays persistent; collapsing its panel does not end control", () => {
  assert.match(source, /data-remote-badge/);
  assert.match(source, /data-remote-panel/);
  assert.match(source, /data-remote-end/);
  assert.match(source, /const collapseRemotePanel = \(\) => \{\s*if \(!remotePanel\) return;\s*remotePanel\.hidden = true;/);
  assert.match(source, /remoteBadge\.onclick = \(\) => \{/);
  assert.doesNotMatch(source, /remoteBadge\.onclick[\s\S]{0,120}closeRemote/);
});

test("ending the remote from its panel closes the session and immediately regenerates a new QR", () => {
  assert.match(source, /document\.querySelector\("\[data-remote-end\]"\)\.onclick = \(\) => \{ closeRemote\(\); collapseRemotePanel\(\); openRemote\(\); \}/);
});

test("the remote panel closes via its own close button or a click outside the corner", () => {
  assert.match(source, /data-remote-panel-close/);
  assert.match(source, /document\.querySelector\("\[data-remote-panel-close\]"\)\.onclick = collapseRemotePanel/);
  assert.match(source, /document\.onclick = \(event\) => \{\s*if \(remotePanel && !remotePanel\.hidden && !remoteCorner\.contains\(event\.target\)\) collapseRemotePanel\(\);/);
});

test("the idle badge carries a label and hides while the panel is expanded to avoid corner ghosting", () => {
  assert.match(source, /<span class="remote-badge-label">扫码遥控投屏<\/span>/);
  assert.match(styles, /\.remote-badge\[aria-expanded="true"\] \{ visibility: hidden; \}/);
});

test("Presentation remote expires after three hours", () => {
  assert.match(source, /REMOTE_TIMEOUT_MS/);
  assert.match(source, /createRemoteSession\(createRemoteRoomId\(\)\)/);
  assert.match(source, /savedRemoteSession\(roomIdFromHash\(\)\)/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /if \(Date\.now\(\) >= remoteExpiresAt\) \{\s*closeRemote\(\);\s*return;\s*\}/);
});

test("signal timer keeps the session limit inside the ring and shows an audible-style bell hint", () => {
  assert.doesNotMatch(source, /data-timer-label\]"\)\.textContent = [^;]*牌/);
  assert.doesNotMatch(source, /无声/);
  assert.match(source, /data-timer-bell hidden>🛎️ 叮叮～</);
  assert.doesNotMatch(styles, /\.timer-style-card \.has-signals \.timer-card \{[^}]*rotate/);
});

test("signal timer shows no card before the green node", () => {
  assert.match(source, /data-timer-card hidden aria-hidden="true"><\/div>/);
  assert.match(source, /\[data-timer-card\]"\);\s*card\.hidden = state === "waiting";/);
  assert.doesNotMatch(source, /state === "waiting" \? "green"/);
  assert.match(styles, /\.slide-timer\.has-signals\.signal-waiting \{ --timer-signal: var\(--pres-timer-label\); \}/);
  assert.doesNotMatch(styles, /\.signal-waiting \.timer-card \{ opacity/);
  assert.match(styles, /\.slide-timer\.has-signals \.timer-card\[hidden\] \{ display: none; \}/);
});

test("Table Topics speakers render locally first and sync to Feishu in the background", () => {
  const save = source.slice(source.indexOf("async function saveTableTopicsEntries"), source.indexOf("const remoteCorner"));
  assert.doesNotMatch(save, /await apiJson/, "录入 Speaker 不能等飞书写完再显示");
  assert.match(save, /renderTableTopicsDrawSlides\(\{ panel \}\);[\s\S]*tableTopicsSync\.push\(\{ entries: nextEntries, currentTableTopicsEntryId \}\)/);
  assert.match(source, /if \(!live\?\.meeting \|\| tableTopicsSync\.hasLocalChanges\(\)\) return;/, "轮询不能覆盖未同步的本地名单");
  assert.match(source, /<strong>Table Topics live<\/strong>\$\{tableTopicsSyncStatus\(\)\}/);
  assert.match(source, /data-tabletopics-sync-retry/);
  assert.match(styles, /\.tabletopics-live-panel \.tabletopics-sync \{/);
});
