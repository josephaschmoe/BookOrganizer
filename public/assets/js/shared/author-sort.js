function _tomeShelfLooksLikeInvertedSingleAuthor(value) {
  var raw = String(value || "").trim();
  var commaParts;
  var left;
  var right;
  var leftWords;
  var rightWords;
  var honorifics;
  if (!raw.includes(",")) return false;
  commaParts = raw.split(",").map(function(part) { return part.trim(); }).filter(Boolean);
  if (commaParts.length !== 2) return false;

  left = commaParts[0];
  right = commaParts[1];
  if (!left || !right) return false;

  leftWords = left.split(/\s+/).filter(Boolean);
  rightWords = right.split(/\s+/).filter(Boolean);
  if (!leftWords.length || !rightWords.length) return false;

  honorifics = new Set(["mr", "mr.", "mrs", "mrs.", "ms", "ms.", "dr", "dr.", "sir", "lady", "rev", "rev.", "prof", "prof."]);
  if (leftWords.length > 4 || rightWords.length > 4) return false;
  if (honorifics.has(leftWords[0].toLowerCase())) return false;
  return leftWords.length <= 2;
}

function _tomeShelfExtractPrimaryAuthorName(author, looksLikeFn) {
  var raw = String(author || "").trim();
  var explicitSplit;
  var commaParts;
  if (!raw) return "";
  explicitSplit = raw.split(/\s+(?:and|&)\s+|;/i).map(function(part) { return part.trim(); }).filter(Boolean);
  if (explicitSplit.length > 1) return explicitSplit[0];
  if (!raw.includes(",")) return raw;

  commaParts = raw.split(",").map(function(part) { return part.trim(); }).filter(Boolean);
  if (commaParts.length <= 1) return raw;
  if (looksLikeFn(raw)) return raw;
  return commaParts[0];
}

function _tomeShelfBuildAuthorSortKey(author, extractFn, looksLikeFn) {
  var raw = String(author || "").trim();
  var primary;
  var parts;
  var suffixes;
  var particles;
  var end;
  var start;
  var surname;
  var given;

  if (!raw) return "";
  primary = extractFn(raw);
  if (!primary) return "";
  if (looksLikeFn(primary)) return primary;

  parts = primary.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return primary;

  suffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
  particles = new Set([
    "da", "de", "del", "della", "der", "di", "du", "la", "le", "st.", "st",
    "van", "von", "den", "ten", "ter", "vel", "bin", "ibn", "al", "ap"
  ]);

  end = parts.length - 1;
  while (end > 0 && suffixes.has(parts[end].toLowerCase())) end -= 1;

  start = end;
  while (start > 0 && particles.has(parts[start - 1].toLowerCase())) start -= 1;

  surname = parts.slice(start, end + 1).join(" ");
  given = parts.slice(0, start).concat(parts.slice(end + 1)).join(" ").trim();
  return given ? surname + ", " + given : surname;
}

function looksLikeInvertedSingleAuthor(value) {
  return _tomeShelfLooksLikeInvertedSingleAuthor(value);
}

function extractPrimaryAuthorName(author) {
  return _tomeShelfExtractPrimaryAuthorName(author, looksLikeInvertedSingleAuthor);
}

function buildAuthorSortKey(author) {
  return _tomeShelfBuildAuthorSortKey(author, extractPrimaryAuthorName, looksLikeInvertedSingleAuthor);
}

function looksLikeSharedInvertedSingleAuthor(value) {
  return _tomeShelfLooksLikeInvertedSingleAuthor(value);
}

function extractSharedPrimaryAuthorName(author) {
  return _tomeShelfExtractPrimaryAuthorName(author, looksLikeSharedInvertedSingleAuthor);
}

function buildSharedAuthorSortKey(author) {
  return _tomeShelfBuildAuthorSortKey(author, extractSharedPrimaryAuthorName, looksLikeSharedInvertedSingleAuthor);
}
