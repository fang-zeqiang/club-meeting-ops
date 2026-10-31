#!/usr/bin/env node
// 用法：node mm-ics.mjs <calendar.json | -> [--out <file.ics>] [--now <ISO>]
// 输入是 vpe_get_meeting_role_sop(role="Meeting Manager") 返回的"日历数据" JSON：
//   { "meetingNumber": 115, "sopUrl": "...", "events": [{ "title", "timeLabel", "doneCriteria", "reminderAt" }] }
// 也可以直接传整段工具返回文本，脚本会取出其中的 ```json 代码块。
// 本脚本随 skill 安装到 MM 本机，必须零依赖；输出与仓库 mm-timeline.js 的 timelineToIcs 保持一致（有测试守着）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsStamp(instant) {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function calendarToIcs(calendar, now = new Date()) {
  const number = calendar.meetingNumber;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VPE Agenda//Meeting Manager Timeline//ZH", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(`Meeting Manager #${number}`)}`];
  calendar.events.forEach((item, index) => {
    const start = new Date(item.reminderAt);
    if (Number.isNaN(start.getTime())) throw new Error(`Invalid reminderAt: ${item.reminderAt}`);
    const summary = `[MM] ${item.title || item.timeLabel || "SOP"}`;
    const description = [item.timeLabel && `SOP 时间：${item.timeLabel}`, item.doneCriteria && `完成标准：${item.doneCriteria}`, calendar.sopUrl && `SOP：${calendar.sopUrl}`].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:mm-${number}-${index + 1}@vpe-agenda`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(start)}`,
      "DURATION:PT30M",
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:PT0M",
      `DESCRIPTION:${icsEscape(summary)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function parseCalendarInput(text) {
  const fenced = String(text).match(/```json\s*([\s\S]*?)```/);
  const calendar = JSON.parse(fenced ? fenced[1] : text);
  if (!Number.isInteger(calendar?.meetingNumber) || !Array.isArray(calendar.events) || !calendar.events.length) {
    throw new Error("Calendar JSON needs meetingNumber and a non-empty events array.");
  }
  return calendar;
}

function main(argv) {
  const args = [...argv];
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return "";
    const [, value] = args.splice(index, 2);
    return value || "";
  };
  const out = option("--out");
  const now = option("--now");
  const source = args[0];
  if (!source) {
    console.error("Usage: node mm-ics.mjs <calendar.json | -> [--out <file.ics>] [--now <ISO>]");
    process.exit(1);
  }
  const calendar = parseCalendarInput(readFileSync(source === "-" ? 0 : source, "utf8"));
  const target = resolve(out || `mm-${calendar.meetingNumber}-timeline.ics`);
  writeFileSync(target, calendarToIcs(calendar, now ? new Date(now) : new Date()));
  console.log(`${target}（${calendar.events.length} 个节点，双击导入飞书日历或系统日历）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
