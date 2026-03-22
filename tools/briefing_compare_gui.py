import json
import os
import threading
import time
import urllib.error
import urllib.request
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText


LEFT_MODEL = "sonar"
RIGHT_MODEL = "sonar-pro"
PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
BACKUP_SCHEMA_VERSION = 1
CONFIG_PATH = Path(__file__).with_name("briefing_compare_gui.local.json")
DEFAULT_PERPLEXITY_MAX_TOKENS = 2500

SECTION_ORDER = [
    "genre",
    "quick_take",
    "major_themes",
    "historical_context",
    "impact",
    "confidence_note",
    "summary",
    "key_elements",
    "craft_analysis",
    "discussion_questions",
    "key_takeaways",
    "editorial_approach",
    "contents_overview",
    "production_notes",
    "notable_features",
    "ideal_for",
    "summary_safe",
    "summary_spoiler",
    "key_elements_safe",
    "key_elements_spoiler",
    "craft_analysis_safe",
    "craft_analysis_spoiler",
    "discussion_questions_safe",
    "discussion_questions_spoiler",
    "generated_at",
    "model",
]


def clean_text(value):
    return str(value or "").strip()[:600]


def sanitize_book(book):
    source = book if isinstance(book, dict) else {}
    return {
        "title": clean_text(source.get("title")),
        "author": clean_text(source.get("author")),
        "year": clean_text(source.get("year")),
        "publisher": clean_text(source.get("publisher")),
        "edition": clean_text(source.get("edition")),
        "isbn": clean_text(source.get("isbn")),
        "subjects": clean_text(source.get("subjects")),
        "notes": clean_text(source.get("notes")),
    }


def build_prompt(book):
    return "\n".join(
        [
            "Create a structured, college-level book briefing.",
            "Write as though leading a strong classroom or book club discussion.",
            "Use the supplied metadata only as guidance; do not invent certainty.",
            "",
            "Book metadata:",
            f"Title: {book.get('title') or 'Unknown'}",
            f"Author: {book.get('author') or 'Unknown'}",
            f"Year: {book.get('year') or 'Unknown'}",
            f"Publisher: {book.get('publisher') or 'Unknown'}",
            f"Edition: {book.get('edition') or 'Unknown'}",
            f"ISBN: {book.get('isbn') or 'Unknown'}",
            f"Subjects: {book.get('subjects') or 'Unknown'}",
            f"Notes: {book.get('notes') or 'None'}",
            "",
            "Return valid JSON. First, set genre, then populate the fields for that genre.",
            "",
            "--- Always ---",
            'genre: "fiction", "non-fiction", or "reference" - decide based on the book\'s primary purpose.',
            "- fiction: novels, stories, narrative poetry",
            "- non-fiction: books that argue, analyze, or narrate (history, biography, memoir, criticism, science)",
            "- reference: books primarily consulted rather than read (cookbooks, field guides, how-to, craft manuals, travel guides, practical references)",
            "quick_take: 2 to 4 spoiler-free sentences summarizing what the book is and why it matters.",
            "major_themes: 3 to 6 concise bullet-style strings.",
            "historical_context: one paragraph.",
            "impact: one paragraph on why the work matters and how it lands.",
            "confidence_note: mention ambiguity, factual uncertainty, edition limits, and classification ambiguity when relevant.",
            "If the book straddles reference and non-fiction, classify by primary use and note the ambiguity in confidence_note.",
            "",
            "--- If fiction: provide BOTH spoiler and spoiler-free versions of these four fields ---",
            "summary_spoiler: full plot synopsis with spoilers in one or two paragraphs.",
            "summary_safe: premise and setup only - no major reveals, twists, or endings.",
            "key_elements_spoiler: 3 to 6 bullet-style strings about characters including arcs and fates.",
            "key_elements_safe: 3 to 6 bullet-style strings introducing characters without revealing spoilers.",
            "craft_analysis_spoiler: one or two paragraphs about style, structure, symbols, or technique - may reference plot freely.",
            "craft_analysis_safe: one or two paragraphs about style and technique without revealing plot points.",
            "discussion_questions_spoiler: 6 strong seminar questions that may reference the full plot.",
            "discussion_questions_safe: 6 strong seminar questions safe for someone who has not finished the book.",
            "Do NOT populate the singular non-fiction or reference fields for fiction.",
            "",
            "--- If non-fiction: use these singular fields (no spoiler variants needed) ---",
            "summary: the core argument, thesis, and structure of the book in one or two paragraphs.",
            "key_elements: 3 to 6 bullet-style strings about key concepts, figures, or frameworks.",
            "craft_analysis: one or two paragraphs about methodology, argument quality, evidence, and structure.",
            "discussion_questions: 6 strong seminar questions.",
            "key_takeaways: 3 to 6 bullet-style strings of actionable insights or lessons.",
            "Do NOT populate the fiction or reference fields for non-fiction.",
            "",
            "--- If reference (cookbooks, field guides, how-to, craft manuals, catalogs, practical guides): use these singular fields ---",
            "editorial_approach: one or two paragraphs on the book's organizational logic, target audience, and overall philosophy or point of view.",
            "contents_overview: 3 to 6 bullet-style strings describing the major sections, categories, recipe types, or structural components.",
            "production_notes: one paragraph on format, visual design, photography or illustration quality, writing style, and usability as a practical object.",
            "notable_features: 3 to 6 bullet-style strings on what makes this book distinctive - signature recipes or entries, unusual techniques, cultural specificity, standout design choices.",
            "ideal_for: 2 to 4 sentences describing the best audience for this book and how they would realistically use it.",
            "Do NOT populate the fiction or non-fiction fields for reference.",
            "",
            "--- Additional Perplexity Verification Rules ---",
            "Use web search to verify factual claims about publication history, plot content, chapter or canto coverage, character identities, edition-specific details, and the practical scope of reference books.",
            "Treat metadata fields with values like Unknown, None, or blank as missing hints rather than evidence.",
            "For claims about specific contents, volume divisions, chapter ranges, canto ranges, subtitles, edition details, recipes, techniques, or section breakdowns, only state them if you found a confirming source.",
            "If you cannot verify a specific claim, say so explicitly in the relevant field and in confidence_note.",
            "Within JSON string values, you may include compact inline source references like [Source: https://example.com] or [Sources: https://a, https://b] for verified factual claims.",
            "If a factual claim is only weakly supported, prefer uncertainty language over confident synthesis.",
        ]
    )


def build_perplexity_system_prompt():
    return " ".join(
        [
            "You are a precise book discussion assistant for fiction, non-fiction, and reference books.",
            "Create a college-level book briefing.",
            "Search the web for accurate, up-to-date information about this book.",
            "First decide if the book is fiction, non-fiction, or reference, then populate the genre-appropriate fields.",
            "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
            "Reference books are primarily consulted rather than read straight through.",
            "If the book straddles reference and non-fiction, classify by primary use and note the ambiguity in confidence_note.",
            "Verify specific factual claims before asserting them, especially content divisions, volume scope, edition details, recipes, techniques, and reference-book section breakdowns.",
            "Treat Unknown or blank metadata as missing, not as evidence.",
            "Inline source references inside JSON string values are allowed when they help anchor verified facts.",
            "Separate factual claims from interpretation when uncertainty exists.",
            "If the book is obscure, the title is ambiguous, or the details may be wrong, say so clearly in confidence_note.",
            "Return valid JSON only - no markdown fences, no backticks, no extra text before or after the JSON object.",
        ]
    )


def parse_research_json(text):
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(text[start : end + 1])

    last_exc = None
    for candidate in candidates:
        for variant in generate_json_repair_variants(candidate):
            try:
                return json.loads(variant)
            except json.JSONDecodeError as exc:
                last_exc = exc
                continue

    if last_exc is None:
        raise RuntimeError("Model reply did not contain a JSON object.")
    raise RuntimeError(describe_json_error(text, last_exc))


def describe_json_error(text, exc):
    start = max(0, exc.pos - 180)
    end = min(len(text), exc.pos + 180)
    excerpt = text[start:end].replace("\n", "\\n")
    return f"Invalid JSON from model at line {exc.lineno}, column {exc.colno}: {exc.msg}\\nContext: {excerpt}"


def repair_common_json_issues(text):
    chars = []
    in_string = False
    escaped = False
    length = len(text)

    def next_non_whitespace(index):
        while index < length and text[index] in " \t\r\n":
            index += 1
        return text[index] if index < length else ""

    for index, ch in enumerate(text):
        if in_string:
            if escaped:
                chars.append(ch)
                escaped = False
                continue
            if ch == "\\":
                chars.append(ch)
                escaped = True
                continue
            if ch == '"':
                next_char = next_non_whitespace(index + 1)
                if next_char and next_char not in [",", "}", "]", ":"]:
                    chars.append('\\"')
                    continue
                chars.append(ch)
                in_string = False
                continue
            if ch == "\n":
                chars.append("\\n")
                continue
            if ch == "\r":
                chars.append("\\r")
                continue
            if ch == "\t":
                chars.append("\\t")
                continue
            chars.append(ch)
            continue

        chars.append(ch)
        if ch == '"':
            in_string = True

    repaired = "".join(chars)
    repaired = repaired.replace(",}", "}").replace(",]", "]")
    return repaired


def normalize_json_string_lines(text):
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('"') and stripped.endswith('"') and ":" not in stripped:
            escaped = line.replace("\\", "\\\\").replace('"', '\\"')
            first_quote = escaped.find('\\"')
            last_quote = escaped.rfind('\\"')
            if first_quote != -1 and last_quote != -1 and last_quote > first_quote:
                escaped = escaped[:first_quote] + '"' + escaped[first_quote + 2:last_quote] + '"' + escaped[last_quote + 2:]
            lines.append(escaped)
            continue
        lines.append(line)
    return "\n".join(lines)


def generate_json_repair_variants(text):
    variants = []
    seen = set()

    def add(value):
        if value not in seen:
            seen.add(value)
            variants.append(value)

    add(text)
    repaired = repair_common_json_issues(text)
    add(repaired)
    normalized = normalize_json_string_lines(text)
    add(normalized)
    add(repair_common_json_issues(normalized))
    return variants


def fetch_with_retry(url, data, headers, retries=2, base_delay=1.2):
    payload = json.dumps(data).encode("utf-8")
    last_error = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                body = response.read().decode("utf-8")
                return response.status, body
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code not in (429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {exc.code}: {body[:800]}")
            last_error = RuntimeError(f"HTTP {exc.code}: {body[:800]}")
        except urllib.error.URLError as exc:
            last_error = RuntimeError(str(exc.reason))
            if attempt == retries:
                raise last_error
        time.sleep(base_delay * (2 ** attempt))
    if last_error:
        raise last_error
    raise RuntimeError("Request failed.")


def call_perplexity_for_book(book, api_key, model, max_tokens):
    system_prompt = build_perplexity_system_prompt()
    user_prompt = build_prompt(book)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": int(max_tokens),
        "temperature": 0.4,
        "return_images": False,
        "return_related_questions": False,
    }
    _, raw = fetch_with_retry(
        PERPLEXITY_API_URL,
        payload,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    parsed = json.loads(raw)
    text = (((parsed.get("choices") or [{}])[0]).get("message") or {}).get("content", "").strip()
    if not text:
        raise RuntimeError("Perplexity returned no content.")
    parsed_ok = True
    try:
        research = parse_research_json(text)
    except RuntimeError:
        parsed_ok = False
        research = {
            "raw_response": text,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "model": f"perplexity-{model}",
            "parse_status": "raw_text_fallback",
        }
    if parsed_ok:
        research["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        research["model"] = f"perplexity-{model}"
    return research, payload, {"model": model, "system_prompt": system_prompt, "user_prompt": user_prompt, "raw_text": text, "parsed_ok": parsed_ok}


def normalize_backup_manifest(raw):
    manifest = raw if isinstance(raw, dict) else {}
    return {
        "schemaVersion": int(manifest.get("schemaVersion") or 0),
        "books": manifest.get("books") if isinstance(manifest.get("books"), list) else [],
    }


def load_local_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_local_config(data):
    CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_books_from_export(path):
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            if "manifest.json" not in zf.namelist():
                raise RuntimeError("Backup ZIP is missing manifest.json.")
            manifest = normalize_backup_manifest(json.loads(zf.read("manifest.json").decode("utf-8")))
            books = manifest["books"]
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
        books = data.get("books") if isinstance(data.get("books"), list) else []
    if not books:
        raise RuntimeError("No books found in the selected export.")
    normalized = []
    for book in books:
        clean = sanitize_book(book)
        if not clean.get("title"):
            continue
        clean["_raw"] = deepcopy(book)
        normalized.append(clean)
    return normalized


def format_briefing_for_display(research):
    if isinstance(research, dict) and research.get("parse_status") == "raw_text_fallback":
        return "\n".join(
            [
                f"Model: {research.get('model', '')}",
                "Parse Status: raw_text_fallback",
                "",
                research.get("raw_response", ""),
            ]
        ).strip()

    ordered = []
    seen = set()
    for key in SECTION_ORDER:
        if key in research:
            ordered.append((key, research[key]))
            seen.add(key)
    for key, value in research.items():
        if key not in seen:
            ordered.append((key, value))

    lines = []
    for key, value in ordered:
        label = key.replace("_", " ").title()
        if isinstance(value, list):
            lines.append(f"{label}:")
            for item in value:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{label}:")
            lines.append(str(value))
        lines.append("")
    return "\n".join(lines).strip()


def make_log_entry(book, left_result, right_result, left_payload, right_payload, left_meta, right_meta):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return "\n".join(
        [
            "=" * 100,
            f"Comparison Timestamp: {timestamp}",
            f"Title: {book.get('title', '')}",
            f"Author: {book.get('author', '')}",
            f"Year: {book.get('year', '')}",
            f"Publisher: {book.get('publisher', '')}",
            f"Edition: {book.get('edition', '')}",
            f"ISBN: {book.get('isbn', '')}",
            f"Subjects: {book.get('subjects', '')}",
            f"Notes: {book.get('notes', '')}",
            "",
            f"Left Model ({left_meta.get('model', LEFT_MODEL)}) System Prompt:",
            left_meta.get("system_prompt", ""),
            "",
            f"Left Model ({left_meta.get('model', LEFT_MODEL)}) User Prompt:",
            left_meta.get("user_prompt", ""),
            "",
            f"Right Model ({right_meta.get('model', RIGHT_MODEL)}) System Prompt:",
            right_meta.get("system_prompt", ""),
            "",
            f"Right Model ({right_meta.get('model', RIGHT_MODEL)}) User Prompt:",
            right_meta.get("user_prompt", ""),
            "",
            f"Left Model ({left_meta.get('model', LEFT_MODEL)}) Request:",
            json.dumps(left_payload, indent=2, ensure_ascii=False),
            "",
            f"Right Model ({right_meta.get('model', RIGHT_MODEL)}) Request:",
            json.dumps(right_payload, indent=2, ensure_ascii=False),
            "",
            f"Left Model ({left_meta.get('model', LEFT_MODEL)}) Result:",
            json.dumps(left_result, indent=2, ensure_ascii=False),
            "",
            f"Right Model ({right_meta.get('model', RIGHT_MODEL)}) Result:",
            json.dumps(right_result, indent=2, ensure_ascii=False),
            "",
        ]
    )


def make_error_log_entry(book, stage, message, left_payload=None, right_payload=None, left_meta=None, right_meta=None, left_result=None, right_result=None, raw_outputs=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    raw_outputs = raw_outputs or {}
    return "\n".join(
        [
            "=" * 100,
            f"Comparison Timestamp: {timestamp}",
            f"Failure Stage: {stage}",
            f"Error: {message}",
            f"Title: {book.get('title', '')}",
            f"Author: {book.get('author', '')}",
            f"Year: {book.get('year', '')}",
            "",
            f"Left Model ({(left_meta or {}).get('model', LEFT_MODEL)}) System Prompt:",
            (left_meta or {}).get("system_prompt", ""),
            "",
            f"Left Model ({(left_meta or {}).get('model', LEFT_MODEL)}) User Prompt:",
            (left_meta or {}).get("user_prompt", ""),
            "",
            f"Right Model ({(right_meta or {}).get('model', RIGHT_MODEL)}) System Prompt:",
            (right_meta or {}).get("system_prompt", ""),
            "",
            f"Right Model ({(right_meta or {}).get('model', RIGHT_MODEL)}) User Prompt:",
            (right_meta or {}).get("user_prompt", ""),
            "",
            f"Left Model ({(left_meta or {}).get('model', LEFT_MODEL)}) Request:",
            json.dumps(left_payload or {}, indent=2, ensure_ascii=False),
            "",
            f"Right Model ({(right_meta or {}).get('model', RIGHT_MODEL)}) Request:",
            json.dumps(right_payload or {}, indent=2, ensure_ascii=False),
            "",
            f"Left Model ({(left_meta or {}).get('model', LEFT_MODEL)}) Result:",
            json.dumps(left_result or {}, indent=2, ensure_ascii=False),
            "",
            f"Right Model ({(right_meta or {}).get('model', RIGHT_MODEL)}) Result:",
            json.dumps(right_result or {}, indent=2, ensure_ascii=False),
            "",
            f"Raw Left Model ({(left_meta or {}).get('model', LEFT_MODEL)}) Output:",
            raw_outputs.get("left", ""),
            "",
            f"Raw Right Model ({(right_meta or {}).get('model', RIGHT_MODEL)}) Output:",
            raw_outputs.get("right", ""),
            "",
        ]
    )


class BriefingCompareApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Book Briefing Model Compare")
        self.root.geometry("1600x920")
        self.config = load_local_config()

        self.books = []
        self.filtered_indexes = []
        self.current_export_path = None
        self.log_path = Path(self.config.get("log_path") or (Path.cwd() / "briefing_compare_log.txt"))

        self.perplexity_key_var = tk.StringVar(value=self.config.get("perplexity_api_key") or os.getenv("PERPLEXITY_API_KEY", ""))
        self.perplexity_max_tokens_var = tk.StringVar(value=str(self.config.get("perplexity_max_tokens", DEFAULT_PERPLEXITY_MAX_TOKENS)))
        self.filter_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Load a backup JSON or ZIP export to begin.")
        self.log_var = tk.StringVar(value=str(self.log_path))

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=10)
        top.pack(fill="x")

        ttk.Button(top, text="Open Export", command=self.open_export).grid(row=0, column=0, padx=(0, 8), pady=4, sticky="w")
        ttk.Button(top, text="Choose Log File", command=self.choose_log_file).grid(row=0, column=1, padx=(0, 8), pady=4, sticky="w")
        ttk.Label(top, text="Log:").grid(row=0, column=2, sticky="e")
        ttk.Entry(top, textvariable=self.log_var, width=70).grid(row=0, column=3, padx=(4, 10), sticky="we")
        top.columnconfigure(3, weight=1)

        ttk.Label(top, text="Perplexity Key").grid(row=1, column=0, sticky="e", pady=4)
        ttk.Entry(top, textvariable=self.perplexity_key_var, show="*", width=40).grid(row=1, column=1, padx=(4, 10), sticky="we")
        ttk.Label(top, text="Models").grid(row=1, column=2, sticky="e", pady=4)
        ttk.Label(top, text=f"Left: {LEFT_MODEL}    Right: {RIGHT_MODEL}").grid(row=1, column=3, sticky="w")

        ttk.Label(top, text="Filter").grid(row=2, column=0, sticky="e", pady=4)
        filter_entry = ttk.Entry(top, textvariable=self.filter_var)
        filter_entry.grid(row=2, column=1, sticky="we", padx=(4, 10))
        filter_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())
        ttk.Label(top, text="Perplexity Max Tokens").grid(row=2, column=2, sticky="e", pady=4)
        ttk.Entry(top, textvariable=self.perplexity_max_tokens_var, width=10).grid(row=2, column=3, sticky="w")

        ttk.Button(top, text="Run Comparison", command=self.run_selected_comparison).grid(row=3, column=2, padx=(0, 8), pady=4, sticky="w")
        ttk.Button(top, text="Show Prompt", command=self.show_prompt_preview).grid(row=3, column=3, sticky="w")

        main = ttk.Panedwindow(self.root, orient=tk.HORIZONTAL)
        main.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        left = ttk.Frame(main, padding=(0, 0, 8, 0))
        main.add(left, weight=1)
        ttk.Label(left, text="Books").pack(anchor="w")
        self.book_list = tk.Listbox(left, exportselection=False)
        self.book_list.pack(fill="both", expand=True)
        self.book_list.bind("<Double-Button-1>", lambda _event: self.run_selected_comparison())

        right = ttk.Panedwindow(main, orient=tk.VERTICAL)
        main.add(right, weight=5)

        prompt_frame = ttk.Frame(right, padding=(8, 0, 0, 0))
        right.add(prompt_frame, weight=1)
        ttk.Label(prompt_frame, text="Book Metadata / Prompt Preview").pack(anchor="w")
        self.prompt_text = ScrolledText(prompt_frame, wrap="word", height=12)
        self.prompt_text.pack(fill="both", expand=True)

        results = ttk.Panedwindow(right, orient=tk.HORIZONTAL)
        right.add(results, weight=4)

        left_frame = ttk.Frame(results, padding=(8, 0, 4, 0))
        results.add(left_frame, weight=1)
        ttk.Label(left_frame, text="Perplexity Sonar").pack(anchor="w")
        self.left_text = ScrolledText(left_frame, wrap="word")
        self.left_text.pack(fill="both", expand=True)

        right_frame = ttk.Frame(results, padding=(4, 0, 0, 0))
        results.add(right_frame, weight=1)
        ttk.Label(right_frame, text="Perplexity Sonar Pro").pack(anchor="w")
        self.right_text = ScrolledText(right_frame, wrap="word")
        self.right_text.pack(fill="both", expand=True)

        bottom = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        bottom.pack(fill="x")
        ttk.Label(bottom, textvariable=self.status_var).pack(anchor="w")

    def open_export(self):
        path = filedialog.askopenfilename(
            title="Open Backup Export",
            filetypes=[
                ("Backup exports", "*.zip *.json"),
                ("ZIP files", "*.zip"),
                ("JSON files", "*.json"),
                ("All files", "*.*"),
            ],
        )
        if not path:
            return
        try:
            self.books = load_books_from_export(path)
        except Exception as exc:
            messagebox.showerror("Load Failed", str(exc))
            return
        self.current_export_path = path
        self.apply_filter()
        self.status_var.set(f"Loaded {len(self.books)} books from {Path(path).name}.")

    def choose_log_file(self):
        path = filedialog.asksaveasfilename(
            title="Choose Comparison Log File",
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("Markdown files", "*.md"), ("All files", "*.*")],
            initialfile=Path(self.log_var.get()).name,
        )
        if path:
            self.log_path = Path(path)
            self.log_var.set(str(self.log_path))
            self.persist_local_config()

    def persist_local_config(self):
        save_local_config(
            {
                "perplexity_api_key": self.perplexity_key_var.get().strip(),
                "perplexity_max_tokens": int(self.perplexity_max_tokens_var.get().strip() or DEFAULT_PERPLEXITY_MAX_TOKENS),
                "log_path": self.log_var.get().strip(),
            }
        )

    def on_close(self):
        self.persist_local_config()
        self.root.destroy()

    def apply_filter(self):
        query = self.filter_var.get().strip().lower()
        self.book_list.delete(0, tk.END)
        self.filtered_indexes = []
        for index, book in enumerate(self.books):
            haystack = " | ".join([book.get("title", ""), book.get("author", ""), book.get("year", ""), book.get("isbn", "")]).lower()
            if query and query not in haystack:
                continue
            self.filtered_indexes.append(index)
            label = f"{book.get('title', 'Untitled')} - {book.get('author', 'Unknown')}"
            if book.get("year"):
                label += f" ({book['year']})"
            self.book_list.insert(tk.END, label)
        if self.filtered_indexes:
            self.book_list.selection_clear(0, tk.END)
            self.book_list.selection_set(0)
            self.book_list.activate(0)
            self.update_prompt_preview()

    def selected_book(self):
        selection = self.book_list.curselection()
        if not selection:
            return None
        return self.books[self.filtered_indexes[selection[0]]]

    def current_perplexity_max_tokens(self):
        raw = self.perplexity_max_tokens_var.get().strip()
        try:
            value = int(raw or DEFAULT_PERPLEXITY_MAX_TOKENS)
        except ValueError:
            raise RuntimeError("Perplexity max tokens must be a whole number.")
        if value < 500 or value > 6144:
            raise RuntimeError("Perplexity max tokens must be between 500 and 6144.")
        return value

    def update_prompt_preview(self):
        book = self.selected_book()
        self.prompt_text.delete("1.0", tk.END)
        if not book:
            return
        self.prompt_text.insert(
            tk.END,
            "\n\n".join(
                [
                    "Book Metadata",
                    json.dumps(sanitize_book(book), indent=2, ensure_ascii=False),
                    "Perplexity System Prompt",
                    build_perplexity_system_prompt(),
                    "Perplexity User Prompt",
                    build_prompt(sanitize_book(book)),
                ]
            ),
        )

    def show_prompt_preview(self):
        self.update_prompt_preview()

    def set_results(self, left_text, right_text):
        self.left_text.delete("1.0", tk.END)
        self.left_text.insert(tk.END, left_text)
        self.right_text.delete("1.0", tk.END)
        self.right_text.insert(tk.END, right_text)

    def run_selected_comparison(self):
        self.update_prompt_preview()
        book = self.selected_book()
        if not book:
            messagebox.showinfo("Select a Book", "Choose a book first.")
            return
        perplexity_key = self.perplexity_key_var.get().strip()
        if not perplexity_key:
            messagebox.showerror("Missing API Key", "Enter PERPLEXITY_API_KEY.")
            return
        try:
            perplexity_max_tokens = self.current_perplexity_max_tokens()
        except RuntimeError as exc:
            messagebox.showerror("Invalid Token Setting", str(exc))
            return
        self.persist_local_config()
        self.status_var.set(f'Comparing Perplexity {LEFT_MODEL} and {RIGHT_MODEL} for "{book.get("title", "")}"...')
        self.set_results("Running...", "Running...")
        threading.Thread(
            target=self._run_compare_worker,
            args=(sanitize_book(book), perplexity_key, perplexity_max_tokens),
            daemon=True,
        ).start()

    def _run_compare_worker(self, book, perplexity_key, perplexity_max_tokens):
        left_result = None
        right_result = None
        left_payload = None
        right_payload = None
        left_meta = {}
        right_meta = {}
        failure_stage = "startup"
        try:
            failure_stage = LEFT_MODEL
            self.root.after(0, lambda: self.status_var.set(f'Running Perplexity {LEFT_MODEL} for "{book.get("title", "")}"...'))
            left_result, left_payload, left_meta = call_perplexity_for_book(book, perplexity_key, LEFT_MODEL, perplexity_max_tokens)
            self.root.after(0, lambda: self.left_text.delete("1.0", tk.END) or self.left_text.insert(tk.END, format_briefing_for_display(left_result)))

            failure_stage = RIGHT_MODEL
            self.root.after(0, lambda: self.status_var.set(f'Running Perplexity {RIGHT_MODEL} (max_tokens={perplexity_max_tokens}) for "{book.get("title", "")}"...'))
            right_result, right_payload, right_meta = call_perplexity_for_book(book, perplexity_key, RIGHT_MODEL, perplexity_max_tokens)
            self.root.after(0, lambda: self.right_text.delete("1.0", tk.END) or self.right_text.insert(tk.END, format_briefing_for_display(right_result)))

            log_entry = make_log_entry(book, left_result, right_result, left_payload, right_payload, left_meta, right_meta)
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(log_entry)
            self.root.after(0, lambda: self._on_compare_success(book, left_result, right_result))
        except Exception as exc:
            error_message = str(exc)
            try:
                error_entry = make_error_log_entry(
                    book,
                    failure_stage,
                    error_message,
                    left_payload=left_payload,
                    right_payload=right_payload,
                    left_meta=left_meta,
                    right_meta=right_meta,
                    left_result=left_result,
                    right_result=right_result,
                    raw_outputs={
                        "left": left_meta.get("raw_text", ""),
                        "right": right_meta.get("raw_text", ""),
                    },
                )
                self.log_path.parent.mkdir(parents=True, exist_ok=True)
                with self.log_path.open("a", encoding="utf-8") as handle:
                    handle.write(error_entry)
            except Exception:
                pass
            self.root.after(0, lambda: self._on_compare_error(error_message, left_result, right_result))

    def _on_compare_success(self, book, left_result, right_result):
        self.set_results(
            format_briefing_for_display(left_result),
            format_briefing_for_display(right_result),
        )
        self.status_var.set(f'Comparison complete for "{book.get("title", "")}". Appended to {self.log_path.name}.')

    def _on_compare_error(self, message, left_result=None, right_result=None):
        self.set_results(
            format_briefing_for_display(left_result) if left_result else f"Error:\n{message}",
            format_briefing_for_display(right_result) if right_result else f"Error:\n{message}",
        )
        self.status_var.set("Comparison failed.")
        messagebox.showerror("Comparison Failed", message)


def main():
    root = tk.Tk()
    app = BriefingCompareApp(root)
    app.book_list.bind("<<ListboxSelect>>", lambda _event: app.update_prompt_preview())
    root.mainloop()


if __name__ == "__main__":
    main()
