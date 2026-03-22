function prepareLightboxItems(urls) {
  return (Array.isArray(urls) ? urls : [])
    .map(function(url) { return String(url || "").trim(); })
    .filter(Boolean);
}
