export const DEFAULT_TIMER_STYLE = "card";
export const TIMER_STYLES = Object.freeze([
  { id: "card", label: "卡片签", short: "A", description: "当前颜色卡片从圆环侧面露出" },
  { id: "stack", label: "三牌叠放", short: "B", description: "三张卡片常驻，当前卡片提亮" },
  { id: "inset", label: "圆内翻牌", short: "C", description: "颜色牌嵌在圆环下方" },
]);

export function normalizeTimerStyle(value) {
  return TIMER_STYLES.find((style) => style.id === value)?.id || DEFAULT_TIMER_STYLE;
}

export function timerSignalsForItem(item) {
  const explicit = [item.timerGreenSec, item.timerYellowSec, item.timerRedSec, item.timerBellSec].map(Number);
  if (explicit.every(Number.isFinite) && explicit[0] >= 0 && explicit[0] < explicit[1] && explicit[1] < explicit[2] && explicit[2] < explicit[3]) {
    return { green: explicit[0], yellow: explicit[1], red: explicit[2], bell: explicit[3] };
  }
  if (item.kind === "break") return null;
  // 无显式节点时按 Agenda 时长倒推：长环节提前 2/1 分钟、3–5 分钟提前 1/0.5 分钟、更短按 50%/75%；
  // 7min→5/6/7、6min→4/5/6、3min→2/2.5/3、2min→1/1.5/2，与常用 club preset 对齐。🔔 固定为红灯后 30 秒。
  const red = Math.round(Number(item.duration) * 60);
  if (!Number.isFinite(red) || red <= 0) return null;
  const [green, yellow] = red >= 300 ? [red - 120, red - 60] : red >= 180 ? [red - 60, red - 30] : [Math.round(red * 0.5), Math.round(red * 0.75)];
  if (!(green < yellow && yellow < red)) return null;
  return { green, yellow, red, bell: red + 30 };
}

export function timerSignalState(elapsed, rule) {
  if (!rule) return "none";
  if (elapsed >= rule.bell) return "bell";
  if (elapsed >= rule.red) return "red";
  if (elapsed >= rule.yellow) return "yellow";
  if (elapsed >= rule.green) return "green";
  return "waiting";
}
