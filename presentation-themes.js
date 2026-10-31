// 投屏页视觉主题注册表。前端编辑器、投屏页、后端 schema 校验共用同一份白名单。
// 注意:与 meeting.theme(会议文案主题,如 "Journey")是两回事。

export const DEFAULT_PRESENTATION_THEME = "sky";

export const PRESENTATION_THEMES = [
  { id: "sky", label: "晴空(默认)" },
  { id: "white", label: "素白" },
  { id: "current", label: "深蓝(旧版)" },
  { id: "midautumn", label: "中秋" },
  { id: "halloween", label: "万圣节" },
];

const THEME_IDS = new Set(PRESENTATION_THEMES.map((theme) => theme.id));

export function isPresentationTheme(value) {
  return THEME_IDS.has(String(value || "").trim());
}

// 存量会议记录没有该字段,统一回落到默认主题,不做数据迁移。
export function normalizePresentationTheme(value) {
  const normalized = String(value || "").trim();
  // 返回白名单里的常量而不是输入值本身，避免外部输入直接进入 HTML
  return PRESENTATION_THEMES.find((theme) => theme.id === normalized)?.id || DEFAULT_PRESENTATION_THEME;
}
