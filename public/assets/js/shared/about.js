function refreshAboutCopy() {
  var isSharePage = Boolean(document.getElementById("headerShelfName"))
    || window.location.pathname.indexOf("/share/") !== -1
    || /Shared Shelf/i.test(document.title);

  document.querySelectorAll(".about-feature").forEach(function(card) {
    var title = card.querySelector("strong");
    var copy = card.querySelector("p");
    var heading;
    if (!title || !copy) return;
    heading = (title.textContent || "").trim();
    if (heading === "Auto-Generated Briefings") {
      copy.textContent = "Rich, college-level discussion guides appear automatically as you add books - themes, historical context, literary analysis, discussion questions, and genre-specific structure for fiction, non-fiction, and reference titles.";
    } else if (heading === "Share Your Shelves") {
      title.textContent = "Share Shelves and Books";
      copy.textContent = "Generate read-only links for whole shelves or individual books - viewers need no account. Control whether notes, Wikipedia lookup, audio, and book photos are included, and revoke access at any time.";
    }
  });

  document.querySelectorAll(".about-more-section-title").forEach(function(titleEl) {
    var heading = (titleEl.textContent || "").trim();
    var list = titleEl.nextElementSibling;
    if (!list || !list.classList || !list.classList.contains("about-more-list")) return;
    if (heading === "AI Research Briefings") {
      list.querySelectorAll("li").forEach(function(item) {
        var text = (item.textContent || "").trim();
        if (text.includes("toggle with one tap")) {
          item.innerHTML = "<strong>Fiction</strong> briefings default to spoiler-safe summaries, character notes, analysis, and discussion questions";
        }
      });
      return;
    }

    if (heading !== "Shelf Sharing" && heading !== "Sharing") return;

    titleEl.textContent = "Sharing";
    list.innerHTML = (isSharePage
      ? [
          "<li>Generate a <strong>public, read-only share link</strong> for any shelf or any individual book - viewers need no account or sign-in</li>",
          "<li>One active link per shelf and one active link per book; any number of people can use the same link simultaneously</li>",
          "<li>Per-share controls: include personal notes (off by default), enable AI-powered Wikipedia lookups for viewers, enable audio briefings for viewers, and for single-book shares choose whether additional photos are included</li>",
          "<li>Shelf shares let viewers browse books, read briefings, and navigate the shelf; single-book shares open directly to that book's discussion page</li>",
          "<li>Revoke links from the shelf's Share button, the book detail Share Book button, or from Account Settings at any time</li>"
        ]
      : [
          "<li>Generate a <strong>public, read-only share link</strong> for any shelf or any individual book - viewers need no account or sign-in</li>",
          "<li>One active link per shelf and one active link per book; any number of people can use the same link simultaneously</li>",
          "<li>Per-share controls: include personal notes (off by default), enable AI-powered Wikipedia lookup for viewers, enable audio briefings for viewers, and for single-book shares choose whether additional photos are included</li>",
          "<li>Shelf shares let viewers browse the shelf and open book details; single-book shares open directly to that book's briefing page</li>",
          "<li>Viewers can browse books, read briefings, view Wikipedia articles, and play shared audio - but cannot edit, add, or remove anything</li>",
          "<li>Revoke links from the shelf's Share button, the book detail Share Book button, or from Account Settings at any time</li>",
          "<li>Account Settings separates active links into <strong>Shared Shelves</strong> and <strong>Shared Books</strong> for easier management</li>",
          "<li>The shared detail panel has an expand toggle for a wider reading view; state persists</li>",
          "<li>Cover lightbox automatically attempts a higher-resolution Google Books image before falling back to the original</li>"
        ]).join("");
  });
}
