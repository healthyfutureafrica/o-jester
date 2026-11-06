// Progressive enhancements only — every page works without JavaScript.
document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-copy]");
  if (!btn) return;
  const source = document.getElementById(btn.dataset.copy);
  if (!source) return;
  const text = source.value || source.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    source.select?.();
    document.execCommand("copy");
  }
  const label = btn.textContent;
  btn.textContent = btn.dataset.copied || "✓";
  setTimeout(() => (btn.textContent = label), 1800);
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) event.preventDefault();
});

document.querySelectorAll("[data-copy]").forEach((btn) => btn.classList.remove("hide"));
