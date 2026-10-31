export function mountTemporaryTextEditor(root) {
  const button = root.querySelector("[data-edit-text]");
  const targets = [...root.querySelectorAll("[data-editable-text]")];
  let editing = false;

  const toggle = () => {
    editing = !editing;
    root.classList.toggle("text-editing", editing);
    button.classList.toggle("active", editing);
    button.setAttribute("aria-pressed", String(editing));
    button.querySelector("span").textContent = editing ? "Done editing" : "Edit text";
    targets.forEach((target) => {
      if (editing) target.setAttribute("contenteditable", "plaintext-only");
      else target.removeAttribute("contenteditable");
    });
  };

  button.addEventListener("click", toggle);
  root.addEventListener("paste", (event) => {
    if (!event.target.closest('[contenteditable="plaintext-only"]')) return;
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
  });
  return {
    handleShortcut(event) {
      if (event.key.toLocaleLowerCase() !== "e" || event.target.closest("input, textarea, select, [contenteditable]")) return false;
      event.preventDefault();
      toggle();
      return true;
    },
    isEditing: () => editing,
  };
}
