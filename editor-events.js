export function bindEditorEvents(root, { onEdit, onClick, onSubmit }) {
  root.addEventListener("input", onEdit);
  root.addEventListener("change", onEdit);
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
}
