import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { EMPTY_IMAGE, FUTURE_POSTER_KINDS, MAX_OFFICER_IMAGE_BYTES, MAX_QR_IMAGE_BYTES } from "./contract.js";
import { imageUrl, renderAgendaSyncTip, renderQrFrame } from "./derivations.js";
import { flushSave, renderMediaRegion, renderOfficerRegion, renderOverlayRegion, renderPreviewRegion, renderStatusRegion, renderToastRegion, renderValidationRegion, updateMeetingSummary, withUiContinuity } from "./render-engine.js";
import { state } from "./state.js";

export function renderImageEditor(kind, title, description, image) {
  const busy = state.imageBusy === kind;
  const emptyHint = kind === "wechat-payment-qr" ? "JPEG or PNG · original ratio · max 5 MB" : "JPEG or PNG · square · max 2 MB";
  return `<article class="image-upload-card asset-upload-card">
    ${renderQrFrame(kind, image, "editor-qr asset-preview")}
    <div class="image-upload-copy">
      <strong>${title}</strong>
      <p>${description}</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : emptyHint}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading image…") : ""}
  </article>`;
}

export function renderOfficerImageEditor(image) {
  const busy = state.imageBusy === "officer-team";
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame editor-photo asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl("officer-team", image))}" alt="Officer team" />` : "<span>Officer team photo<br />not uploaded</span>"}
    </div>
    <div class="image-upload-copy">
      <strong>Officer team image</strong>
      <p>Global across all meetings. Back page shows full image without stretching.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · 16:9 recommended · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="officer-team" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="officer-team" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading officer image…") : ""}
  </article>`;
}

function renderFuturePosterEditor(kind, image, index) {
  const busy = state.imageBusy === kind;
  const required = index === 1;
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame future-poster-preview asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl(kind, image))}" alt="Future meeting poster ${index}" />` : `<span>Future poster ${index}<br />not uploaded</span>`}
    </div>
    <div class="image-upload-copy">
      <div class="asset-title-row"><strong>Future meeting poster ${index}</strong><span class="asset-requirement ${required ? "required" : "optional"}">${required ? "Required" : "Optional"}</span></div>
      <p>${required ? "Creates the poster slide after Voting & Announcement." : "Appears beside Poster 1 when uploaded."} Shared across meetings.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" data-focus-key="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading future poster…") : ""}
  </article>`;
}

export function renderFuturePostersTask() {
  const ready = Boolean(state.futurePosters[0]?.present);
  return `<section class="section-card future-posters-task" data-region="media">
    <div class="section-heading future-posters-heading">
      <div><span class="eyebrow">Presentation asset</span><h2>Future meeting posters</h2><p>Keep upcoming meeting promotion current without tying it to one meeting.</p></div>
      <span class="poster-readiness ${ready ? "ready" : "missing"}">${ready ? "Required poster ready" : "Required poster missing"}</span>
    </div>
    <div class="section-content image-upload-list">
      ${FUTURE_POSTER_KINDS.map((kind, index) => renderFuturePosterEditor(kind, state.futurePosters[index], index + 1)).join("")}
    </div>
  </section>`;
}

export function renderClubIntroPhotoEditor(image) {
  const kind = "club-intro-photo";
  const busy = state.imageBusy === kind;
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame club-intro-preview asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl(kind, image))}" alt="Club introduction" />` : "<span>Club introduction photo<br />not uploaded</span>"}
    </div>
    <div class="image-upload-copy">
      <strong>Club introduction photo</strong>
      <p>Shown in the Club Intro slide. Large JPEG files are compressed before upload.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Compressing…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Preparing club photo…") : ""}
  </article>`;
}

async function browserImageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function validateClientImage(file, { square = false, maxBytes = MAX_QR_IMAGE_BYTES, label = "image" } = {}) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Choose a JPEG or PNG image.");
  if (!file.size) throw new Error("Choose a non-empty image.");
  if (file.size > maxBytes) throw new Error(`${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`);
  const { width, height } = await browserImageDimensions(file);
  if (!width || !height) throw new Error("The selected image dimensions are invalid.");
  if (square && Math.abs(width - height) / Math.max(width, height) > 0.05) {
    throw new Error(`QR code images must be square or within 5% of 1:1. This image is ${width}×${height}.`);
  }
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The image could not be read.")));
    reader.readAsDataURL(file);
  });
}

async function compressClubIntroPhoto(file) {
  if (file.type !== "image/jpeg") return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (Math.max(image.naturalWidth, image.naturalHeight) <= 1920 && file.size <= MAX_OFFICER_IMAGE_BYTES) return file;
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("The club introduction photo could not be compressed.");
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mediaConflict(error) {
  if (error.status !== 409 || error.code !== "REVISION_CONFLICT") return false;
  state.conflict = { meetingId: state.meeting.id, currentRevision: error.details?.currentRevision };
  state.saveStatus = "conflict";
  return true;
}

async function uploadQrImage(kind, sourceFile) {
  try {
    const file = kind === "club-intro-photo" ? await compressClubIntroPhoto(sourceFile) : sourceFile;
    await validateClientImage(file, kind === "officer-team" || kind === "club-intro-photo" || kind === "wechat-payment-qr" || FUTURE_POSTER_KINDS.includes(kind)
      ? { maxBytes: MAX_OFFICER_IMAGE_BYTES, label: kind === "wechat-payment-qr" ? "WeChat payment images" : kind === "club-intro-photo" ? "Club introduction photos" : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting posters" : "Officer team images" }
      : { square: true, maxBytes: MAX_QR_IMAGE_BYTES, label: "QR code images" });
    state.imageBusy = kind;
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
    });

    if (state.previewMode) {
      const image = {
        present: true,
        name: file.name,
        type: file.type,
        size: file.size,
        version: String(Date.now()),
        url: await fileDataUrl(file),
      };
      if (kind === "voting") state.meeting.votingQr = image;
      else if (kind === "group") state.groupQr = image;
      else if (kind === "wechat-payment-qr") state.paymentQr = image;
      else if (kind === "officer-team") state.officerTeamPhoto = image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = image;
      state.toast = kind === "club-intro-photo" ? "Club introduction photo loaded for this local preview." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster loaded for this local preview." : kind === "officer-team" ? "Officer team image loaded for this local preview." : kind === "wechat-payment-qr" ? "WeChat payment image loaded for this local preview." : "QR code loaded for this local preview.";
      return;
    }

    if (kind === "voting") {
      await flushSave();
      if (["error", "conflict"].includes(state.saveStatus)) return;
      const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/images/voting`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
          "X-Expected-Revision": String(state.meeting.revision || 0),
        },
        body: file,
      });
      state.meeting.votingQr = body.image;
      state.meeting.revision = body.revision;
      updateMeetingSummary(state.meeting);
      state.toast = "Voting QR code saved to Feishu Base.";
    } else if (kind === "group") {
      const body = await apiJson("/api/assets/group-qr", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      state.groupQr = body.image;
      state.toast = "Global guest group QR code saved to Feishu Base.";
    } else {
      const assetKind = kind === "officer-team" ? "officer-team-photo" : kind;
      const body = await apiJson(`/api/assets/${assetKind}`, {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      if (kind === "officer-team") state.officerTeamPhoto = body.image;
      else if (kind === "wechat-payment-qr") state.paymentQr = body.image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = body.image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = body.image;
      state.toast = kind === "club-intro-photo" ? "Club introduction photo saved to Feishu Base." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster saved to Feishu Base." : kind === "wechat-payment-qr" ? "WeChat payment image saved to Feishu Base." : "Global officer team image saved to Feishu Base.";
    }
  } catch (error) {
    if (!mediaConflict(error)) state.toast = error.message;
  } finally {
    state.imageBusy = "";
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
      renderPreviewRegion();
      renderValidationRegion();
      renderStatusRegion();
      renderToastRegion();
      renderOverlayRegion();
    });
  }
}

async function removeQrImage(kind) {
  if (!window.confirm(`Remove the ${kind === "voting" ? "voting" : kind === "group" ? "guest group" : kind === "wechat-payment-qr" ? "WeChat payment" : kind === "club-intro-photo" ? "club introduction" : FUTURE_POSTER_KINDS.includes(kind) ? "future meeting poster" : "officer team"} image?`)) return;
  state.imageBusy = kind;
  withUiContinuity(() => {
    renderMediaRegion();
    renderOfficerRegion();
  });
  try {
    if (state.previewMode) {
      if (kind === "voting") state.meeting.votingQr = { ...EMPTY_IMAGE };
      else if (kind === "group") state.groupQr = { ...EMPTY_IMAGE };
      else if (kind === "wechat-payment-qr") state.paymentQr = { ...EMPTY_IMAGE };
      else if (kind === "officer-team") state.officerTeamPhoto = { ...EMPTY_IMAGE };
      else if (kind === "club-intro-photo") state.clubIntroPhoto = { ...EMPTY_IMAGE };
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = { ...EMPTY_IMAGE };
      state.toast = kind === "club-intro-photo" ? "Club introduction photo removed from this local preview." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster removed from this local preview." : kind === "officer-team" ? "Officer team image removed from this local preview." : kind === "wechat-payment-qr" ? "WeChat payment image removed from this local preview." : "QR code removed from this local preview.";
      return;
    }

    if (kind === "voting") {
      await flushSave();
      if (["error", "conflict"].includes(state.saveStatus)) return;
      const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/images/voting`, {
        method: "DELETE",
        headers: { "X-Expected-Revision": String(state.meeting.revision || 0) },
      });
      state.meeting.votingQr = body.image;
      state.meeting.revision = body.revision;
      updateMeetingSummary(state.meeting);
    } else if (kind === "group") {
      const body = await apiJson("/api/assets/group-qr", { method: "DELETE" });
      state.groupQr = body.image;
    } else {
      const assetKind = kind === "officer-team" ? "officer-team-photo" : kind;
      const body = await apiJson(`/api/assets/${assetKind}`, { method: "DELETE" });
      if (kind === "officer-team") state.officerTeamPhoto = body.image;
      else if (kind === "wechat-payment-qr") state.paymentQr = body.image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = body.image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = body.image;
    }
    state.toast = kind === "club-intro-photo" ? "Club introduction photo removed." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster removed." : kind === "officer-team" ? "Officer team image removed." : kind === "wechat-payment-qr" ? "WeChat payment image removed." : "QR code removed.";
  } catch (error) {
    if (!mediaConflict(error)) state.toast = error.message;
  } finally {
    state.imageBusy = "";
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
      renderPreviewRegion();
      renderValidationRegion();
      renderStatusRegion();
      renderToastRegion();
      renderOverlayRegion();
    });
  }
}

export async function handleChange(input, event) {
  if (input.matches("[data-upload-image]")) {
    const [file] = input.files || [];
    if (file) await uploadQrImage(input.dataset.uploadImage, file);
  } else {
    return false;
  }
  return true;
}

export async function handleClick(button, event) {
  if (button.matches("[data-remove-image]")) {
    await removeQrImage(button.dataset.removeImage);
  } else {
    return false;
  }
  return true;
}
