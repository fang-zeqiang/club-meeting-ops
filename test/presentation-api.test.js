import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toGuestMeeting, toPresentationMeeting } from "../server/presentation-repository.js";

const meetingApi = await readFile(new URL("../api/meetings/[id].js", import.meta.url), "utf8");
const votingApi = await readFile(new URL("../api/meetings/[id]/voting.js", import.meta.url), "utf8");
const votingImageApi = await readFile(new URL("../api/meetings/[id]/images/voting.js", import.meta.url), "utf8");
const awardsApi = await readFile(new URL("../api/meetings/[id]/awards.js", import.meta.url), "utf8");
const meetingsApi = await readFile(new URL("../api/meetings/index.js", import.meta.url), "utf8");

test("public presentation APIs do not require an editing session", () => {
  assert.ok(meetingApi.indexOf('request.query.view === "presentation"') < meetingApi.indexOf("if (!requireSession(request, response))"));
  assert.match(votingApi, /publicPresentationImage && !requireSession|!publicPresentationImage && !requireSession/);
  assert.match(votingImageApi, /publicPresentationImage && !requireSession|!publicPresentationImage && !requireSession/);
  assert.ok(awardsApi.indexOf('request.query.view === "confirmed"') < awardsApi.indexOf("if (!requireSession(request, response))"));
});

test("public presentation data excludes editor-only meeting fields", () => {
  const meeting = toPresentationMeeting({
    id: "meeting_101",
    meetingNumber: 101,
    date: "2026-07-14",
    theme: "Share",
    status: "draft",
    revision: 9,
    review: { private: true },
    votingForm: { editUrl: "https://example.test/private" },
    qrSource: "system",
    votingQr: { present: false },
    systemVotingQr: { present: true, version: "abc" },
    blocks: [{
      id: "block_private",
      title: "Opening",
      notes: "editor note",
      items: [{
        id: "item_private",
        kind: "role",
        session: "Welcome",
        role: "Host",
        duration: 3,
        member: "Alex",
        memberId: "member_private",
        evaluator: "",
        speechObjective: "",
        externalPresentationUrl: "https://example.com/slides/demo",
        status: "confirmed",
      }],
    }],
  });

  assert.equal(meeting.meetingNumber, 101);
  assert.equal(meeting.blocks[0].items[0].member, "Alex");
  assert.equal(meeting.blocks[0].items[0].externalPresentationUrl, "https://example.com/slides/demo");
  assert.equal("votingForm" in meeting, false);
  assert.equal("review" in meeting, false);
  assert.equal("revision" in meeting, false);
  assert.equal("notes" in meeting.blocks[0], false);
  assert.equal("memberId" in meeting.blocks[0].items[0], false);
});

test("guest Agenda data is final-only and excludes management fields", () => {
  const meeting = toGuestMeeting({
    id: "meeting_private", meetingNumber: 102, date: "2026-07-14", startTime: "18:40", theme: "Travel", venue: "Shanghai", status: "final", revision: 8,
    votingForm: { editUrl: "private" }, wordOfDay: { word: "Explore", pronunciation: "", example: "" },
    blocks: [{ id: "block_private", title: "Opening", notes: "private", items: [{ id: "item_private", kind: "role", session: "Welcome", role: "Host", duration: 3, member: "Alex", memberId: "member_private", status: "confirmed" }] }],
  });
  assert.equal(meeting.meetingNumber, 102);
  assert.equal(meeting.blocks[0].items[0].member, "Alex");
  assert.equal("id" in meeting, false);
  assert.equal("memberId" in meeting.blocks[0].items[0], false);
  assert.equal("status" in meeting.blocks[0].items[0], false);
  assert.equal("votingForm" in meeting, false);
  assert.ok(meetingsApi.indexOf('request.query.view === "guest"') < meetingsApi.indexOf("if (!requireSession(request, response))"));
  assert.match(meetingsApi, /meeting\.status === "final"/);
});
