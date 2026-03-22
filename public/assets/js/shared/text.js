function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function paragraphize(text) {
  return esc(String(text || "")).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>");
}

function renderList(items, className) {
  var list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return "<p>No details returned.</p>";
  return '<ul class="' + className + '">' + list.map(function(item) {
    return "<li>" + esc(item) + "</li>";
  }).join("") + "</ul>";
}

function bookIconSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
}
