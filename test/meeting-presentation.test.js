import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { derivePresentationSlides, isAwardsItem, isVoteItem } from "../meeting-presentation-model.js";

const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");
const source = await readFile(new URL("../meeting-presentation.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../meeting-presentation.css", import.meta.url), "utf8");
const vercelConfig = await readFile(new URL("../vercel.json", import.meta.url), "utf8");

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
  assert.match(source, /awards\?view=confirmed/);
  assert.match(source, /\/m\/\$\{encodeURIComponent\(data\.confirmedAwards\.meetingNumber \|\| meetingId\)\}\/awards/);
  assert.doesNotMatch(source, /Sign in to Agenda/);
  assert.doesNotMatch(entry, /presentation.*awards.*present/);
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
  assert.equal(slides.find((slide) => slide.type === "awards").awardPageUrl, "/meetings/meeting_99/awards/present");
  assert.equal(slides.some((slide) => slide.type === "future-posters"), false);
});

test("future posters insert one optional slide immediately after voting", () => {
  const one = derivePresentationSlides(meeting, { futurePosters: ["/poster-1"] });
  const two = derivePresentationSlides(meeting, { futurePosters: ["/poster-1", "/poster-2"] });
  const voteIndex = one.findIndex((slide) => slide.type === "vote");
  assert.equal(one[voteIndex + 1].type, "future-posters");
  assert.deepEqual(one[voteIndex + 1].images, ["/poster-1"]);
  assert.deepEqual(two[two.findIndex((slide) => slide.type === "vote") + 1].images, ["/poster-1", "/poster-2"]);
});

test("future poster preview mode loads only the poster slide and hides deck chrome", () => {
  assert.match(source, /Boolean\(posterRoute\) \|\| query\.get\("preview"\) === "future-posters"/);
  assert.match(source, /posterPreviewMode[\s\S]*slides: posters\[0\] \? \[\{ key: "future-posters", type: "future-posters", images: posters\.filter\(Boolean\) \}\] : \[\]/);
  assert.match(source, /posterPreviewMode \? "poster-preview" : ""/);
  assert.match(styles, /\.meeting-presentation\.poster-preview \.presentation-controls[\s\S]*display: none/);
});

test("external content inserts one interactive slide immediately after its agenda item", () => {
  const withExternal = structuredClone(meeting);
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
    url: "https://example.com/slides/demo",
  });
});

test("presentation refresh, outline, award state, and break editing share one deck", () => {
  const slides = derivePresentationSlides(meeting, { awardState: { ready: false, url: "", reason: "Reconfirm awards." } });
  assert.equal(slides.find((slide) => slide.type === "awards").awardState.reason, "Reconfirm awards.");
  assert.ok(slides.every((slide) => slide.key));
  assert.match(source, /data-refresh-agenda/);
  assert.match(source, /Refresh deck/);
  assert.match(source, /data-external-controls/);
  assert.match(source, /External link/);
  assert.match(source, /function controlIcon/);
  assert.match(source, /currentDeckState/);
  assert.match(source, /resume\.timerRemaining/);
  assert.match(source, /data-outline-index/);
  assert.match(source, /data-page-jump/);
  assert.match(source, /data-break-speakers/);
  assert.match(source, /action=speakers/);
  assert.match(source, /tableId: deck\.votingTableId/);
  assert.match(source, /Award results have not been confirmed/);
  assert.match(styles, /\.presentation-outline/);
  assert.match(styles, /\.break-voting-prompt/);
  assert.match(styles, /\.external-controls/);
});

test("vote and awards matching use item text, not block names", () => {
  assert.equal(isVoteItem({ session: "Vote & Announcement", role: "President" }), true);
  assert.equal(isVoteItem({ session: "Timer Report", role: "Timer" }), false);
  assert.equal(isAwardsItem({ session: "Awards", role: "President" }), true);
});

test("presentation styling stays visually separate from certificate awards", () => {
  assert.match(styles, /aspect-ratio: 16 \/ 9/);
  assert.match(source, /CLUB_PROFILE\.logo/);
  assert.match(source, /new Set\(\["current", "sky", "white"\]\)/);
  assert.match(source, /theme-\$\{presentationTheme\(\)\}/);
  assert.match(styles, /theme-sky/);
  assert.match(styles, /theme-white/);
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
  assert.match(source, /class="slide-timer"/);
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
  assert.doesNotMatch(styles, /certificate/);
});
