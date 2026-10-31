import { ApiError } from "./bitable.js";
import { isBookingMeetingEditable } from "./booking-repository.js";
import { meetingSchema, selectedMeeting, tableTopicsPresentationUrl } from "./mcp-agenda-read.js";
import { createTopic, deleteTopic, drawTopic, listTopics, topicsRemainingCount, updateTopic } from "./table-topics-repository.js";

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const WRITE = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
const SECRECY_NOTE = "话题在抽出前对会员保密，请勿在群聊或对话中提前透露话题内容。";

function requireWritableMeeting(meeting) {
  if (!isBookingMeetingEditable(meeting)) {
    throw new ApiError(409, "MEETING_LOCKED", "Only a current or future Draft meeting can change Table Topics.");
  }
}

function requireExplicitMeetingSelector(rawArguments) {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) return;
  // 两者都传时由 selectedMeeting 校验是否指向同一场；这里只拦"一个都没传"。
  if (rawArguments.meeting_number == null && rawArguments.meeting_reference == null) {
    throw new ApiError(400, "INVALID_MEETING_SELECTOR", "Use meeting_number or meeting_reference. Combine them only when they point to the same meeting.");
  }
}

export const TABLE_TOPICS_TOOLS = Object.freeze([
  {
    name: "vpe_list_table_topics",
    title: "查询 Table Topics 话题",
    description: `List the Table Topics prompts prepared for one meeting, including full text (management view). ${SECRECY_NOTE}`,
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_add_table_topic",
    title: "新增 Table Topics 话题",
    description: `Add one Table Topics prompt to a meeting. ${SECRECY_NOTE}`,
    inputSchema: meetingSchema({
      topic_text: { type: "string", minLength: 1, maxLength: 500, description: "The Table Topics prompt text." },
    }),
    annotations: WRITE,
  },
  {
    name: "vpe_remove_table_topic",
    title: "删除 Table Topics 话题",
    description: "Remove one Table Topics prompt from a meeting by its key (from vpe_list_table_topics or vpe_add_table_topic).",
    inputSchema: meetingSchema({
      topic_key: { type: "string", minLength: 1, description: "The topic's key, from vpe_list_table_topics or vpe_add_table_topic." },
    }),
    annotations: WRITE,
  },
  {
    name: "vpe_update_table_topic",
    title: "更新 Table Topics 话题",
    description: `Update one Table Topics prompt in place by its key. ${SECRECY_NOTE}`,
    inputSchema: {
      ...meetingSchema({
        topic_key: { type: "string", minLength: 1, description: "The topic's key, from vpe_list_table_topics or vpe_add_table_topic." },
        topic_text: { type: "string", minLength: 1, maxLength: 500, description: "The replacement Table Topics prompt text." },
      }),
      required: ["topic_key", "topic_text"],
      anyOf: [{ required: ["meeting_number"] }, { required: ["meeting_reference"] }],
    },
    annotations: WRITE,
  },
  {
    name: "vpe_preview_table_topic_draw",
    title: "预览抽题效果",
    description: `Preview one randomly picked Table Topics prompt from the pool. This never removes or marks the topic; it does not affect the live on-screen draw progress at the meeting, and is safe to call repeatedly ahead of time. ${SECRECY_NOTE}`,
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
]);

const TOOL_NAMES = new Set(TABLE_TOPICS_TOOLS.map(({ name }) => name));

export async function callTableTopicsTool(name, rawArguments, principal, baseUrl) {
  if (!TOOL_NAMES.has(name)) return null;
  if (name === "vpe_list_table_topics") {
    const { meeting } = await selectedMeeting(rawArguments);
    const topics = await listTopics(meeting.id);
    const keyList = topics.map((topic, index) => `${index + 1}) key=${topic.key}`).join("，");
    return {
      data: { meetingNumber: meeting.meetingNumber, topics },
      message: topics.length ? `#${meeting.meetingNumber} 有 ${topics.length} 条话题：${keyList}。` : `#${meeting.meetingNumber} 还没有话题。`,
    };
  }
  if (name === "vpe_preview_table_topic_draw") {
    const { meeting } = await selectedMeeting(rawArguments);
    const poolTotal = await topicsRemainingCount(meeting.id);
    const drawn = await drawTopic(meeting.id, []);
    return {
      data: { meetingNumber: meeting.meetingNumber, topicText: drawn.topicText, poolTotal },
      message: `预览抽取（不消耗、不影响会场正式抽取进度）：${drawn.topicText}。题库共 ${poolTotal} 条话题。`,
    };
  }
  if (name === "vpe_add_table_topic") {
    const { args, meeting } = await selectedMeeting(rawArguments, ["meeting_number", "meeting_reference", "topic_text"]);
    requireWritableMeeting(meeting);
    if (typeof args.topic_text !== "string") throw new ApiError(400, "INVALID_ARGUMENTS", "topic_text is required.");
    const topic = await createTopic(meeting.id, args.topic_text, principal?.id || "mcp");
    const tableTopicsUrl = tableTopicsPresentationUrl(baseUrl, meeting);
    return {
      data: { meetingNumber: meeting.meetingNumber, topic, tableTopicsUrl },
      message: `已为 #${meeting.meetingNumber} 添加一条话题（key=${topic.key}）：“${topic.topicText}”。投屏页：${tableTopicsUrl}`,
    };
  }
  if (name === "vpe_update_table_topic") {
    requireExplicitMeetingSelector(rawArguments);
    const { args, meeting } = await selectedMeeting(rawArguments, ["meeting_number", "meeting_reference", "topic_key", "topic_text"]);
    requireWritableMeeting(meeting);
    if (typeof args.topic_key !== "string" || !args.topic_key) throw new ApiError(400, "INVALID_ARGUMENTS", "topic_key is required.");
    if (typeof args.topic_text !== "string") throw new ApiError(400, "INVALID_ARGUMENTS", "topic_text is required.");
    const topic = await updateTopic(meeting.id, args.topic_key, args.topic_text);
    const tableTopicsUrl = tableTopicsPresentationUrl(baseUrl, meeting);
    return {
      data: { meetingNumber: meeting.meetingNumber, topic, tableTopicsUrl },
      message: `已更新 #${meeting.meetingNumber} 的话题（key=${topic.key}）：“${topic.topicText}”。投屏页：${tableTopicsUrl}`,
    };
  }
  const { args, meeting } = await selectedMeeting(rawArguments, ["meeting_number", "meeting_reference", "topic_key"]);
  requireWritableMeeting(meeting);
  if (typeof args.topic_key !== "string" || !args.topic_key) throw new ApiError(400, "INVALID_ARGUMENTS", "topic_key is required.");
  const deleted = await deleteTopic(meeting.id, args.topic_key);
  const remaining = await topicsRemainingCount(meeting.id);
  const tableTopicsUrl = tableTopicsPresentationUrl(baseUrl, meeting);
  return {
    data: { meetingNumber: meeting.meetingNumber, deleted: true, deletedTopicText: deleted.topicText, remaining, tableTopicsUrl },
    message: `已从 #${meeting.meetingNumber} 删除话题“${deleted.topicText}”，剩余 ${remaining} 条。投屏页：${tableTopicsUrl}`,
  };
}
