var _WIKI_BOOK_RE = /\b(novel|novella|nonfiction|non-fiction|memoir|autobiography|short stor|collection|anthology|graphic novel|play|screenplay|book|poem|poetry|essay|narrative|fiction)\b/i;

function _wikiNorm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _wikiTitleMatches(wikiTitle, term) {
  var w = _wikiNorm(wikiTitle);
  var t = _wikiNorm(term);
  if (t.length <= 2 || w.length <= 2) return false;
  if (w === t || w.includes(t)) return true;
  if (w.length >= 6 && t.startsWith(w)) return true;
  return false;
}

function _wikiMainTitle(title) {
  return (title.replace(/\s*[?:]\s+.+$/, "").trim()) || title;
}

function _wikiShouldSwallowFetchErrors() {
  return window.location.pathname.indexOf("/share/") !== -1 || /Shared Shelf/i.test(document.title);
}

async function _wikiGetSummary(pageTitle) {
  var url;
  var response;
  var data;
  if (!pageTitle) return null;
  url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(pageTitle);
  try {
    response = await fetch(url);
    if (!response.ok) return null;
    data = await response.json();
    return (data.type !== "disambiguation" && data.extract) ? data : null;
  } catch (error) {
    if (_wikiShouldSwallowFetchErrors()) return null;
    throw error;
  }
}

function _wikiNormAuthor(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "");
}

function _wikiAuthorInSummary(summary, author) {
  var primaryAuthor;
  var lastName;
  var needle;
  var haystack;
  if (!author) return true;
  primaryAuthor = author.split(/[,;]/)[0].trim();
  lastName = primaryAuthor.split(/\s+/).pop() || "";
  if (lastName.length < 3) return true;
  needle = _wikiNormAuthor(lastName);
  haystack = _wikiNormAuthor((summary.description || "") + " " + (summary.extract || "").slice(0, 600));
  return haystack.includes(needle);
}

async function _wikiDirectBookLookup(fullTitle, author) {
  var mainTitle = _wikiMainTitle(fullTitle);
  var candidates = [mainTitle];
  var i;
  var summary;
  if (fullTitle !== mainTitle) candidates.push(fullTitle);
  for (i = 0; i < candidates.length; i += 1) {
    summary = await _wikiGetSummary(candidates[i]);
    if (!summary) continue;
    if (_WIKI_BOOK_RE.test(summary.description || "") && _wikiAuthorInSummary(summary, author)) {
      return summary;
    }
  }
  return null;
}
