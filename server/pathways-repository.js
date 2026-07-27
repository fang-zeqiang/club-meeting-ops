import { ApiError, getBitableConfig, listRecords } from "./bitable.js";
import { asText, linkedIds } from "./meeting-schema.js";

function strings(value) {
  if (!Array.isArray(value)) return asText(value).split("\n").map((part) => part.trim()).filter(Boolean);
  return value.map((part) => asText(part).trim()).filter(Boolean);
}

function safeUrl(value) {
  const raw = ((value && typeof value === "object" && !Array.isArray(value) ? asText(value.link) : "") || asText(value)).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.match(/^\[[^\]]*\]\((https:\/\/.+)\)$/)?.[1] || raw);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function invalid(message) {
  throw new ApiError(503, "PATHWAYS_CATALOG_INVALID", message);
}

export function pathwaysCatalogFromRecords(projectRecords, formRecords) {
  const projects = projectRecords.map((record) => ({
    recordId: record.record_id,
    projectId: asText(record.fields.project_id).trim(),
    name: asText(record.fields.name).trim(),
    level: asText(record.fields.level).trim(),
    requiredPaths: strings(record.fields.required_paths),
    electivePaths: strings(record.fields.elective_paths),
    officialPurpose: asText(record.fields.official_purpose).trim(),
    sourceUrl: safeUrl(record.fields.source_url),
    catalogVersion: asText(record.fields.catalog_version).trim(),
    active: record.fields.active === true,
    sortOrder: Number(record.fields.sort_order || 0),
  }));
  const projectsByRecordId = new Map(projects.map((project) => [project.recordId, project]));
  const forms = formRecords.map((record) => {
    const project = projectsByRecordId.get(linkedIds(record.fields.project)[0]);
    return {
      formId: asText(record.fields.form_id).trim(),
      projectId: project?.projectId || "",
      variant: asText(record.fields.variant).trim(),
      speechPurpose: asText(record.fields.speech_purpose).trim(),
      officialResourceUrl: safeUrl(record.fields.official_resource_url),
      pdfUrl: safeUrl(record.fields.pdf_url),
      catalogVersion: asText(record.fields.catalog_version).trim(),
      active: record.fields.active === true,
      sortOrder: Number(record.fields.sort_order || 0),
    };
  });

  const projectById = new Map();
  for (const project of projects) {
    if (!project.projectId || !project.name || !/^[1-5]$/.test(project.level) || !project.officialPurpose || !project.sourceUrl || !(project.requiredPaths.length || project.electivePaths.length)) {
      invalid(`Project ${project.projectId || project.recordId} is incomplete.`);
    }
    if (projectById.has(project.projectId)) invalid(`Duplicate project_id: ${project.projectId}.`);
    projectById.set(project.projectId, project);
  }
  const formById = new Map();
  for (const form of forms) {
    const generic = form.formId === "generic-evaluation-resource";
    if (!form.formId || (!generic && !form.projectId) || !form.variant || !form.officialResourceUrl || !form.pdfUrl || (!generic && !form.speechPurpose)) {
      invalid(`Form ${form.formId || "without form_id"} is incomplete.`);
    }
    if (formById.has(form.formId)) invalid(`Duplicate form_id: ${form.formId}.`);
    formById.set(form.formId, form);
  }
  const paths = [...new Set(projects.filter((project) => project.active).flatMap((project) => [...project.requiredPaths, ...project.electivePaths]))].sort();
  return { projects, forms, paths, projectById, formById };
}

export async function getPathwaysCatalog() {
  const { pathwaysProjectsTableId, pathwaysEvaluationFormsTableId } = getBitableConfig();
  if (!pathwaysProjectsTableId || !pathwaysEvaluationFormsTableId) {
    throw new ApiError(503, "PATHWAYS_CATALOG_NOT_CONFIGURED", "Learning catalog is not configured.");
  }
  const [projects, forms] = await Promise.all([listRecords(pathwaysProjectsTableId), listRecords(pathwaysEvaluationFormsTableId)]);
  return pathwaysCatalogFromRecords(projects, forms);
}

export function publicPathwaysCatalog(catalog, { includeInactive = false } = {}) {
  const projects = catalog.projects
    .filter((project) => includeInactive || project.active)
    .sort((a, b) => Number(a.level) - Number(b.level) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ recordId, ...project }) => project);
  const visibleProjectIds = new Set(projects.map((project) => project.projectId));
  const forms = catalog.forms
    .filter((form) => (includeInactive || form.active) && (!form.projectId || visibleProjectIds.has(form.projectId)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.variant.localeCompare(b.variant));
  return { paths: catalog.paths, projects, forms };
}

export function resolveSpeechDetails(catalog, input = {}, { allowInactive = false } = {}) {
  const mode = String(input.pathwaysMode || "").trim();
  if (!mode) return { pathwaysMode: "", pathwaysPath: "", pathwaysLevel: "", pathwaysProjectId: "", pathwaysFormId: "", speechObjective: "" };
  if (mode === "custom") {
    const speechObjective = String(input.speechObjective || "").trim();
    if (speechObjective.length > 1000) throw new ApiError(400, "INVALID_SPEECH_DETAILS", "演讲目标不能超过 1000 个字符。");
    return { pathwaysMode: "custom", pathwaysPath: "", pathwaysLevel: "", pathwaysProjectId: "", pathwaysFormId: "", speechObjective };
  }
  if (mode !== "pathways") throw new ApiError(400, "INVALID_SPEECH_DETAILS", "请选择有效 Speech type。");

  const pathwaysPath = String(input.pathwaysPath || "").trim();
  const project = catalog.projectById.get(String(input.pathwaysProjectId || "").trim());
  const form = catalog.formById.get(String(input.pathwaysFormId || "").trim());
  if (!project || (!allowInactive && !project.active)) throw new ApiError(400, "INVALID_PATHWAYS_PROJECT", "请选择有效 Learning project。");
  if (!pathwaysPath || ![...project.requiredPaths, ...project.electivePaths].includes(pathwaysPath)) {
    throw new ApiError(400, "INVALID_PATHWAYS_PATH", "Path 与 Project 不匹配。");
  }
  if (!form || form.projectId !== project.projectId || (!allowInactive && !form.active)) {
    throw new ApiError(400, "INVALID_PATHWAYS_FORM", "请选择有效 Speech variant。");
  }
  return {
    pathwaysMode: "pathways",
    pathwaysPath,
    pathwaysLevel: project.level,
    pathwaysProjectId: project.projectId,
    pathwaysFormId: form.formId,
    speechObjective: form.speechPurpose,
  };
}
