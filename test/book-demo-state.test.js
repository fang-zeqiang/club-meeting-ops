import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BOOK_DEMO_SCHEMA_VERSION,
  BOOK_DEMO_STORAGE_KEY,
  createDemoBook,
  demoBookApiJson,
  demoBookDashboard,
  loadDemoBook,
  resetDemoBook,
} from "../book-demo-state.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const [bookStateSource, bookRenderSource, entrySource] = await Promise.all([
  readFile(new URL("../src/book/state.js", import.meta.url), "utf8"),
  readFile(new URL("../src/book/render.js", import.meta.url), "utf8"),
  readFile(new URL("../entry.js", import.meta.url), "utf8"),
]);
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("Role Book demo uses fictional browser-local future and history data", () => {
  const data = createDemoBook();
  assert.equal(data.schemaVersion, BOOK_DEMO_SCHEMA_VERSION);
  assert.ok(data.members.length >= 4);
  assert.ok(data.meetings.some((meeting) => meeting.date > new Date().toISOString().slice(0, 10)));
  assert.ok(data.meetings.some((meeting) => meeting.status === "archived"));
  assert.doesNotMatch(JSON.stringify(data), /Trip\.com|Feishu/i);
  const dashboard = demoBookDashboard(data, "demo-alex");
  assert.ok(dashboard.goals.length);
  assert.ok(dashboard.meetings.some((meeting) => meeting.assignments.some((assignment) => assignment.bookable)));
  assert.equal(dashboard.historyReservations[0].role, "Prepared Speaker");
  assert.equal(dashboard.historyReservations[0].speechDetails.pathwaysProjectId, "demo-purpose");
  assert.equal(dashboard.historyMeetings[0].assignments.find((assignment) => assignment.role === "Prepared Speaker").externalPresentationUrl, "https://example.com/demo-slides");
  assert.ok(dashboard.historyMeetings[0].assignments.every((assignment) => !assignment.bookable && !assignment.manageable));
});

test("Role Book demo partitions today's and past reservations like production", () => {
  const data = createDemoBook();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  data.meetings[0].date = today;
  data.meetings[0].assignments.find((assignment) => assignment.id === "role:timer").memberId = "demo-alex";
  data.meetings[0].assignments.find((assignment) => assignment.id === "role:timer").memberName = "Alex LIN, DL3";

  const dashboard = demoBookDashboard(data, "demo-alex");
  assert.ok(dashboard.reservations.some((reservation) => reservation.date === today && reservation.role === "Timer"));
  assert.deepEqual(dashboard.historyReservations.map(({ meetingNumber, role }) => ({ meetingNumber, role })), [
    { meetingNumber: 128, role: "Prepared Speaker" },
  ]);
  assert.equal(dashboard.historyReservations[0].speechDetails.pathwaysProjectId, "demo-purpose");
});

test("Role Book demo allows same-day draft changes and rejects past draft changes", async () => {
  const todayData = createDemoBook();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  todayData.meetings[0].date = today;
  const todayStorage = new MemoryStorage();
  todayStorage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(todayData));
  await demoBookApiJson("/api/meetings?view=book&action=book", { method: "POST", body: JSON.stringify({ memberId: "demo-alex", meetingId: "demo-book-129", assignmentId: "role:timer" }) }, todayStorage);
  assert.equal(loadDemoBook(todayStorage).meetings[0].assignments.find((assignment) => assignment.id === "role:timer").memberId, "demo-alex");

  const pastData = createDemoBook();
  pastData.meetings[0].date = "2020-01-01";
  const pastStorage = new MemoryStorage();
  pastStorage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(pastData));
  await assert.rejects(
    demoBookApiJson("/api/meetings?view=book&action=book", { method: "POST", body: JSON.stringify({ memberId: "demo-alex", meetingId: "demo-book-129", assignmentId: "role:timer" }) }, pastStorage),
    (error) => error.code === "MEETING_LOCKED",
  );

  const topicData = createDemoBook();
  const topicMeeting = topicData.meetings.find((meeting) => meeting.id === "demo-book-130");
  topicMeeting.date = today;
  const topicStorage = new MemoryStorage();
  topicStorage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(topicData));
  await demoBookApiJson("/api/meetings?view=book&action=table-topic-add", { method: "POST", body: JSON.stringify({ memberId: "demo-yue", meetingId: "demo-book-130", topicText: "Same-day topic" }) }, topicStorage);
  assert.ok(loadDemoBook(topicStorage).meetings.find((meeting) => meeting.id === "demo-book-130").tableTopics.some((topic) => topic.topicText === "Same-day topic"));
  topicData.meetings.find((meeting) => meeting.id === "demo-book-130").date = "2020-01-01";
  const pastTopicStorage = new MemoryStorage();
  pastTopicStorage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(topicData));
  await assert.rejects(
    demoBookApiJson("/api/meetings?view=book&action=table-topic-add", { method: "POST", body: JSON.stringify({ memberId: "demo-yue", meetingId: "demo-book-130", topicText: "Past topic" }) }, pastTopicStorage),
    (error) => error.code === "MEETING_LOCKED",
  );

  topicMeeting.status = "final";
  topicMeeting.date = today;
  const finalTopicStorage = new MemoryStorage();
  finalTopicStorage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(topicData));
  await assert.rejects(
    demoBookApiJson("/api/meetings?view=book&action=table-topic-add", { method: "POST", body: JSON.stringify({ memberId: "demo-yue", meetingId: "demo-book-130", topicText: "Final topic" }) }, finalTopicStorage),
    (error) => error.code === "MEETING_LOCKED",
  );
});

test("Role Book demo persists goals and complete booking actions locally", async () => {
  const storage = new MemoryStorage();
  const post = (action, body) => demoBookApiJson(`/api/meetings?view=book&action=${action}`, { method: "POST", body: JSON.stringify({ memberId: "demo-alex", ...body }) }, storage);
  await post("save-goal", { goal: { role: "Grammarian", targetCount: 2, dueDate: "2099-12-31" } });
  await post("book", { meetingId: "demo-book-129", assignmentId: "role:timer" });
  let dashboard = (await demoBookApiJson("/api/meetings?view=book&memberId=demo-alex", {}, storage)).dashboard;
  assert.ok(dashboard.goals.some((goal) => goal.role === "Grammarian"));
  assert.equal(dashboard.meetings[0].assignments.find((assignment) => assignment.id === "role:timer").mine, true);
  await post("transfer", { meetingId: "demo-book-129", assignmentId: "role:timer", targetMemberId: "demo-yue" });
  dashboard = (await demoBookApiJson("/api/meetings?view=book&memberId=demo-alex", {}, storage)).dashboard;
  assert.equal(dashboard.meetings[0].assignments.find((assignment) => assignment.id === "role:timer").memberId, "demo-yue");
  assert.ok(storage.getItem(BOOK_DEMO_STORAGE_KEY));
});

test("Role Book demo edits speech details, presentation links, cancellations, and goal undo", async () => {
  const storage = new MemoryStorage();
  const post = (action, body) => demoBookApiJson(`/api/meetings?view=book&action=${action}`, { method: "POST", body: JSON.stringify({ memberId: "demo-alex", ...body }) }, storage);
  await post("book", { meetingId: "demo-book-129", assignmentId: "item:speaker-1", speechDetails: { session: "Draft title", pathwaysMode: "" }, externalPresentationUrl: "" });
  await post("update-speech", { meetingId: "demo-book-129", assignmentId: "item:speaker-1", speechDetails: { session: "Final title", pathwaysMode: "custom", speechObjective: "Make one clear point." } });
  await post("update-presentation-url", { meetingId: "demo-book-129", assignmentId: "item:speaker-1", externalPresentationUrl: "https://example.com/slides" });
  let data = loadDemoBook(storage);
  let speech = data.meetings[0].assignments.find((assignment) => assignment.id === "item:speaker-1");
  assert.equal(speech.speechDetails.session, "Final title");
  assert.equal(speech.externalPresentationUrl, "https://example.com/slides");
  assert.equal(data.meetings[0].assignments.find((assignment) => assignment.id === "item:evaluator-1").speakerName, "Alex LIN, DL3");
  await post("cancel", { meetingId: "demo-book-129", assignmentId: "item:speaker-1" });
  data = loadDemoBook(storage);
  speech = data.meetings[0].assignments.find((assignment) => assignment.id === "item:speaker-1");
  assert.equal(speech.status, "vacant");
  assert.deepEqual(speech.speechDetails, {});
  const deleted = await post("delete-goal", { goalId: "goal-alex-1" });
  assert.equal(loadDemoBook(storage).members[0].goals.some((goal) => goal.id === "goal-alex-1"), false);
  await post("restore-goal", { goal: deleted.deleted });
  assert.equal(loadDemoBook(storage).members[0].goals.some((goal) => goal.id === "goal-alex-1"), true);
});

test("Role Book demo scopes Table Topics management to the meeting's TTM", async () => {
  const storage = new MemoryStorage();
  const get = (memberId) => demoBookApiJson(`/api/meetings?view=book&action=table-topics&meetingId=demo-book-130&memberId=${memberId}`, {}, storage);
  const post = (action, memberId, body) => demoBookApiJson(`/api/meetings?view=book&action=${action}`, { method: "POST", body: JSON.stringify({ memberId, meetingId: "demo-book-130", ...body }) }, storage);

  const initial = await get("demo-yue");
  assert.equal(initial.topics.length, 2);
  await assert.rejects(get("demo-alex"), (error) => error.code === "NOT_TTM");
  await assert.rejects(post("table-topic-add", "demo-alex", { topicText: "不该被允许" }), (error) => error.code === "NOT_TTM");

  const created = await post("table-topic-add", "demo-yue", { topicText: "  What made you smile today?  " });
  assert.equal(created.topics[0].topicText, "What made you smile today?");
  assert.equal(created.topics[0].sortOrder, 3);
  await assert.rejects(post("table-topic-add", "demo-yue", { topicText: "" }), (error) => error.code === "INVALID_TOPIC_TEXT");

  const batch = await post("table-topic-add", "demo-yue", { topicTexts: ["  批量一  ", "", "批量二"] });
  assert.deepEqual(batch.topics.map((topic) => topic.topicText), ["批量一", "批量二"]);
  assert.deepEqual(batch.topics.map((topic) => topic.sortOrder), [4, 5]);
  await assert.rejects(post("table-topic-add", "demo-yue", { topicTexts: ["  ", ""] }), (error) => error.code === "INVALID_TOPIC_TEXT");
  await assert.rejects(post("table-topic-add", "demo-yue", { topicTexts: Array.from({ length: 51 }, (_, index) => `话题${index}`) }), (error) => error.code === "TOO_MANY_TOPICS");

  const afterAdd = await get("demo-yue");
  assert.equal(afterAdd.topics.length, 5);
  await post("table-topic-delete", "demo-yue", { key: "demo-topic-1" });
  const afterDelete = await get("demo-yue");
  assert.equal(afterDelete.topics.some((topic) => topic.key === "demo-topic-1"), false);
  assert.equal(afterDelete.topics.length, 4);
});

test("Role Book demo supports Guest booking, reset, and stale-state recovery", async () => {
  const storage = new MemoryStorage();
  await demoBookApiJson("/api/meetings?view=book&action=book-guest", { method: "POST", body: JSON.stringify({ memberId: "demo-alex", meetingId: "demo-book-129", assignmentId: "role:ah-counter", newGuestName: "Taylor, Guest", guestConsentConfirmed: true }) }, storage);
  assert.ok(loadDemoBook(storage).guests.some((guest) => guest.displayName === "Taylor, Guest"));
  resetDemoBook(storage);
  assert.equal(storage.getItem(BOOK_DEMO_STORAGE_KEY), null);
  storage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify({ schemaVersion: 0 }));
  assert.equal(loadDemoBook(storage).members.length, 4);
  const expired = createDemoBook();
  expired.meetings.forEach((meeting) => { meeting.date = "2020-01-01"; });
  storage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(expired));
  assert.notEqual(loadDemoBook(storage).meetings[0].date, "2020-01-01");
});

test("Role Book demo reuses the production UI behind a fail-closed route", () => {
  // demoHandler 存在时 createApiJson 直接短路,不发请求(test/api-client.test.js 覆盖该分支)
  assert.match(bookStateSource, /createApiJson\(\{ demoHandler: BOOK_DEMO_MODE \? demoBookApiJson : null/);
  assert.match(entrySource, /bookingDemoRoute[\s\S]*import\("\.\/book\.js"\)/);
  assert.deepEqual(vercel.rewrites.filter(({ source }) => source.startsWith("/book/demo")), [
    { source: "/book/demo", destination: "/index.html" },
    { source: "/book/demo/", destination: "/index.html" },
  ]);
  assert.match(bookRenderSource, /href="\/book\/demo">体验 Role Book Demo/);
});
