import { roleIdentity } from "./role-awards.js";

export const PRESENTATION_PHASE_OPTIONS = [
  { value: "", label: "按区块与标准角色自动识别" },
  { value: "grammarian_intro", label: "Grammarian Intro · 单词训练卡" },
  { value: "grammarian_report", label: "Grammarian Report · 单词回顾" },
  { value: "timer_report", label: "Timer Report" },
];

export function presentationPhaseForItem(block, item) {
  if (PRESENTATION_PHASE_OPTIONS.some(({ value }) => value && value === item.presentationPhase)) return item.presentationPhase;
  // 旧会议没有阶段字段，使用区块类型和标准角色，不依赖标题或出现顺序。
  if (item.kind !== "role" || roleIdentity(item.role, item.roleId).id !== "grammarian") return "";
  return block.type === "opening" ? "grammarian_intro" : block.type === "closing" ? "grammarian_report" : "";
}
