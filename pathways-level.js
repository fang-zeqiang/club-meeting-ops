// Members 表的 pathways_level 存官网缩写（如 PM5、PM5/EH1）：两位 Path 代码 + 已完成的最高 Level。
export function parsePathwaysLevel(value) {
  return String(value ?? "").split("/").map((part) => /^([A-Z]{2})([1-5])$/.exec(part.trim().toUpperCase()))
    .filter(Boolean)
    .map((match) => ({ code: match[1], level: Number(match[2]) }));
}

export function pathCode(path) {
  return (String(path || "").match(/[A-Za-z]+/g) || []).map((word) => word[0]).join("").toUpperCase();
}

export function pathForCode(code, paths = []) {
  return paths.find((path) => pathCode(path) === code) || "";
}
