import json
import os
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText


MODEL = "gemini-2.5-flash"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
SCRIPT_MODEL = "gemini-2.5-pro"
SCRIPT_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{SCRIPT_MODEL}:generateContent"
CONFIG_PATH = Path(__file__).with_name("briefing_script_tester.local.json")
DEFAULT_LOG_PATH = Path(__file__).with_name("briefing_script_tester_log.txt")


def clean_text(value):
    return str(value or "").strip()[:600]


def sanitize_book(book):
    source = book if isinstance(book, dict) else {}
    return {
        "id": clean_text(source.get("id")),
        "title": clean_text(source.get("title")),
        "author": clean_text(source.get("author")),
        "year": clean_text(source.get("year")),
        "publisher": clean_text(source.get("publisher")),
        "edition": clean_text(source.get("edition")),
        "isbn": clean_text(source.get("isbn")),
        "subjects": clean_text(source.get("subjects")),
        "notes": clean_text(source.get("notes")),
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


def make_log_entry(book, briefing, spoiler_mode, model_name, prompt_text, script):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return "\n".join(
        [
            "=" * 100,
            f"Timestamp: {timestamp}",
            f"Title: {book.get('title', '')}",
            f"Author: {book.get('author', '')}",
            f"Year: {book.get('year', '')}",
            f"ISBN: {book.get('isbn', '')}",
            f"Briefing Model: {briefing.get('model', '')}",
            f"Briefing Genre: {briefing.get('genre', '')}",
            f"Spoiler Mode: {spoiler_mode}",
            f"Script Model: {model_name}",
            "",
            "Narration Prompt:",
            prompt_text,
            "",
            "Generated Script:",
            script,
            "",
        ]
    )


def normalize_manifest(raw):
    manifest = raw if isinstance(raw, dict) else {}
    return {
        "books": manifest.get("books") if isinstance(manifest.get("books"), list) else [],
        "briefings": manifest.get("briefings") if isinstance(manifest.get("briefings"), dict) else {},
    }


def load_manifest(path):
    source = Path(path)
    if source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source, "r") as zf:
            if "manifest.json" not in zf.namelist():
                raise RuntimeError("Backup ZIP is missing manifest.json.")
            raw = json.loads(zf.read("manifest.json").decode("utf-8"))
    else:
        raw = json.loads(source.read_text(encoding="utf-8"))
    return normalize_manifest(raw)


def has_text(value):
    return isinstance(value, str) and value.strip() != ""


def has_list(value):
    return isinstance(value, list) and any(isinstance(item, str) and item.strip() for item in value)


def has_fiction_spoiler_pair(briefing):
    if not isinstance(briefing, dict):
        return False
    if str(briefing.get("genre") or "").lower() != "fiction":
        return False
    return (
        has_text(briefing.get("summary_safe"))
        and has_text(briefing.get("summary_spoiler"))
        and has_list(briefing.get("key_elements_safe"))
        and has_list(briefing.get("key_elements_spoiler"))
        and has_text(briefing.get("craft_analysis_safe"))
        and has_text(briefing.get("craft_analysis_spoiler"))
        and has_list(briefing.get("discussion_questions_safe"))
        and has_list(briefing.get("discussion_questions_spoiler"))
    )


def normalize_spoiler_mode(mode, is_fiction):
    if not is_fiction:
        return "safe"
    return "spoiler" if str(mode or "").strip().lower() == "spoiler" else "safe"


def list_to_narration_lines(items, prefix="- "):
    values = [item for item in (items or []) if item]
    if not values:
        return f"{prefix}No details available."
    return "\n".join(f"{prefix}{item}" for item in values)


def build_narration_prompt(book, briefing, spoiler_mode):
    genre = str(briefing.get("genre") or "").lower()
    is_fiction = genre == "fiction"
    is_reference = genre == "reference"
    safe_mode = normalize_spoiler_mode(spoiler_mode, is_fiction)
    summary_text = (
        briefing.get("summary_spoiler") if safe_mode == "spoiler" else briefing.get("summary_safe")
    ) if is_fiction else (briefing.get("editorial_approach") if is_reference else briefing.get("summary"))
    key_elems = (
        briefing.get("key_elements_spoiler") if safe_mode == "spoiler" else briefing.get("key_elements_safe")
    ) if is_fiction else (briefing.get("contents_overview") if is_reference else briefing.get("key_elements"))
    craft_text = (
        briefing.get("craft_analysis_spoiler") if safe_mode == "spoiler" else briefing.get("craft_analysis_safe")
    ) if is_fiction else (briefing.get("production_notes") if is_reference else briefing.get("craft_analysis"))
    discussion_list = (
        briefing.get("discussion_questions_spoiler") if safe_mode == "spoiler" else briefing.get("discussion_questions_safe")
    ) if is_fiction else (briefing.get("notable_features") if is_reference else briefing.get("discussion_questions"))

    prompt_lines = [
        f"Book title: {book.get('title') or 'Unknown'}",
        f"Author: {book.get('author') or 'Unknown'}",
        f"Year: {book.get('year') or 'Unknown'}",
        f"Genre: {briefing.get('genre') or 'Unknown'}",
        f"Spoiler mode: {safe_mode}",
        "",
        "Use the structured briefing below as source material. Expand every section into a polished solo audio overview.",
        "Treat each heading as a chapter marker with a natural spoken transition.",
        "Do not mention JSON, metadata, bullet points, or field names.",
        "Aim for roughly 600 to 850 words and about 4 to 6 minutes of listening time.",
        "Keep the tone engaged and intelligent, but not gushy, breathless, or promotional.",
        "If the source material suggests mixed, weak, or negative reception, make that clear in a calm, matter-of-fact way.",
        "Do not overpraise the book unless the source material strongly supports it.",
        (
            "For fiction, focus on atmosphere, character arc, structure, and prose."
            if is_fiction
            else (
                "For reference books, focus on organization, usability, standout features, and the book as a practical object."
                if is_reference
                else "For non-fiction, focus on utility, argument quality, key ideas, and real-world application."
            )
        ),
        (
            "Spoilers are allowed. Discuss the full work plainly."
            if safe_mode == "spoiler"
            else "Do not reveal endings, twists, or late-stage character fates beyond the spoiler-safe briefing."
        ),
        "Return only the finished narration script in plain text.",
        "",
        "Quick Take",
        str(briefing.get("quick_take") or ""),
        "",
        "Plot Summary" if is_fiction else ("Editorial Approach" if is_reference else "Overview"),
        str(summary_text or ""),
        "",
        "Major Themes",
        list_to_narration_lines(briefing.get("major_themes")),
        "",
        "Characters" if is_fiction else ("Contents Overview" if is_reference else "Key Concepts and Figures"),
        list_to_narration_lines(key_elems),
        "",
        "Historical and Cultural Context",
        str(briefing.get("historical_context") or ""),
        "",
        "Literary Analysis" if is_fiction else ("Production Notes" if is_reference else "Analysis and Methodology"),
        str(craft_text or ""),
    ]

    if not is_fiction:
        prompt_lines.extend([
            "",
            "Ideal For" if is_reference else "Key Takeaways",
            str(briefing.get("ideal_for") or "") if is_reference else list_to_narration_lines(briefing.get("key_takeaways")),
        ])

    prompt_lines.extend([
        "",
        "Impact",
        str(briefing.get("impact") or ""),
        "",
        "Notable Features" if is_reference else "",
        list_to_narration_lines(discussion_list) if is_reference else "",
        "",
        "Confidence Note",
        str(briefing.get("confidence_note") or ""),
    ])
    return "\n".join(line for line in prompt_lines if line is not None)


def extract_candidate_text(data):
    candidates = ((data or {}).get("candidates") or [])
    for candidate in candidates:
        parts = (((candidate or {}).get("content")) or {}).get("parts") or []
        text_parts = []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text_parts.append(part["text"])
        joined = "\n".join(text_parts).strip()
        if joined:
            return joined
    return ""


def fetch_with_retry(url, data, headers, retries=2, base_delay=1.2, timeout=180):
    payload = json.dumps(data).encode("utf-8")
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code not in (429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {exc.code}: {body[:1200]}")
            last_error = RuntimeError(f"HTTP {exc.code}: {body[:1200]}")
        except urllib.error.URLError as exc:
            last_error = RuntimeError(str(exc.reason))
            if attempt == retries:
                raise last_error
        time.sleep(base_delay * (2 ** attempt))
    if last_error:
        raise last_error
    raise RuntimeError("Request failed.")


def request_script(url, model_name, payload, api_key):
    status, raw_text = fetch_with_retry(
        url,
        payload,
        {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
    )
    if status < 200 or status >= 300:
        raise RuntimeError(f"Unexpected HTTP {status}")
    try:
        parsed = json.loads(raw_text)
    except Exception as exc:
        raise RuntimeError(f"Gemini returned unreadable narration output on {model_name}.") from exc
    script = extract_candidate_text(parsed).strip()
    if not script:
        raise RuntimeError(f"Gemini returned an empty narration script on {model_name}.")
    return script


def generate_narration_script(book, briefing, spoiler_mode, api_key):
    payload = {
        "system_instruction": {
            "parts": [
                {
                    "text": " ".join(
                        [
                            "You are an expert literary podcaster creating a solo Audio Overview of a book.",
                            "Do not summarize the summary. Expand each supplied section into a full discussion.",
                            "Use a conversational, intellectual, accessible tone in the spirit of a public-radio deep dive.",
                            "Sound thoughtful and confident, but never gushy, breathless, or promotional.",
                            "Maintain critical distance: if the material suggests limitations, mixed execution, or poor reception, say so plainly.",
                            "Do not imply acclaim, brilliance, or importance unless the supplied material clearly supports it.",
                            "Use clear transitions such as moving into the narrative structure or historical context.",
                            "Treat the provided headers as chapter markers.",
                            "Return plain text only.",
                        ]
                    )
                }
            ]
        },
        "contents": [{"role": "user", "parts": [{"text": build_narration_prompt(book, briefing, spoiler_mode)}]}],
        "generationConfig": {
            "temperature": 0.7,
            "topP": 0.9,
            "topK": 32,
            "maxOutputTokens": 3072,
        },
    }
    try:
        return request_script(SCRIPT_API_URL, SCRIPT_MODEL, payload, api_key), SCRIPT_MODEL
    except RuntimeError as exc:
        if "HTTP 400:" not in str(exc):
            raise
        return request_script(API_URL, MODEL, payload, api_key), MODEL


class BriefingScriptTesterApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Briefing Script Tester")
        self.root.geometry("1500x920")
        self.config = load_local_config()
        self.items = []
        self.filtered_indexes = []
        self.current_path = None
        self.log_path = Path(self.config.get("log_path") or DEFAULT_LOG_PATH)

        self.gemini_key_var = tk.StringVar(value=self.config.get("gemini_api_key") or os.getenv("GEMINI_API_KEY", ""))
        self.filter_var = tk.StringVar()
        self.spoiler_mode_var = tk.StringVar(value="safe")
        self.status_var = tk.StringVar(value="Open a manifest.json or backup ZIP to begin.")
        self.log_var = tk.StringVar(value=str(self.log_path))

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=10)
        top.pack(fill="x")

        ttk.Button(top, text="Open Manifest / ZIP", command=self.open_manifest).grid(row=0, column=0, padx=(0, 8), pady=4, sticky="w")
        ttk.Button(top, text="Choose Log File", command=self.choose_log_file).grid(row=0, column=1, padx=(0, 8), pady=4, sticky="w")
        ttk.Label(top, text="Log").grid(row=0, column=2, sticky="e", pady=4)
        ttk.Entry(top, textvariable=self.log_var, width=60).grid(row=0, column=3, padx=(4, 10), sticky="we")
        ttk.Entry(top, textvariable=self.gemini_key_var, show="*", width=44).grid(row=1, column=3, padx=(4, 10), sticky="we")
        ttk.Label(top, text="Gemini Key").grid(row=1, column=2, sticky="e", pady=4)
        ttk.Label(top, text="Spoiler Mode").grid(row=1, column=4, sticky="e", pady=4)
        self.spoiler_mode_combo = ttk.Combobox(top, textvariable=self.spoiler_mode_var, values=("safe", "spoiler"), state="readonly", width=12)
        self.spoiler_mode_combo.grid(row=1, column=5, sticky="w")
        self.spoiler_mode_combo.bind("<<ComboboxSelected>>", lambda _event: self.update_prompt_preview())
        top.columnconfigure(3, weight=1)

        ttk.Label(top, text="Filter").grid(row=2, column=2, sticky="e", pady=4)
        filter_entry = ttk.Entry(top, textvariable=self.filter_var)
        filter_entry.grid(row=2, column=3, padx=(4, 10), sticky="we")
        filter_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())
        ttk.Button(top, text="Generate Script", command=self.run_selected_script).grid(row=2, column=5, sticky="w")

        main = ttk.Panedwindow(self.root, orient=tk.HORIZONTAL)
        main.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        left = ttk.Frame(main, padding=(0, 0, 8, 0))
        main.add(left, weight=1)
        ttk.Label(left, text="Perplexity Briefings").pack(anchor="w")
        self.book_list = tk.Listbox(left, exportselection=False)
        self.book_list.pack(fill="both", expand=True)
        self.book_list.bind("<<ListboxSelect>>", lambda _event: self.update_prompt_preview())
        self.book_list.bind("<Double-Button-1>", lambda _event: self.run_selected_script())

        right = ttk.Panedwindow(main, orient=tk.VERTICAL)
        main.add(right, weight=4)

        prompt_frame = ttk.Frame(right, padding=(8, 0, 0, 0))
        right.add(prompt_frame, weight=2)
        ttk.Label(prompt_frame, text="Prompt Preview").pack(anchor="w")
        self.prompt_text = ScrolledText(prompt_frame, wrap="word", height=16)
        self.prompt_text.pack(fill="both", expand=True)

        script_frame = ttk.Frame(right, padding=(8, 0, 0, 0))
        right.add(script_frame, weight=3)
        ttk.Label(script_frame, text="Generated Script").pack(anchor="w")
        self.script_text = ScrolledText(script_frame, wrap="word")
        self.script_text.pack(fill="both", expand=True)

        bottom = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        bottom.pack(fill="x")
        ttk.Label(bottom, textvariable=self.status_var).pack(anchor="w")

    def on_close(self):
        save_local_config({
            "gemini_api_key": self.gemini_key_var.get().strip(),
            "log_path": self.log_var.get().strip(),
        })
        self.root.destroy()

    def choose_log_file(self):
        path = filedialog.asksaveasfilename(
            title="Choose Script Log File",
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("Markdown files", "*.md"), ("All files", "*.*")],
            initialfile=Path(self.log_var.get()).name,
        )
        if path:
            self.log_path = Path(path)
            self.log_var.set(str(self.log_path))
            save_local_config({
                "gemini_api_key": self.gemini_key_var.get().strip(),
                "log_path": self.log_var.get().strip(),
            })

    def open_manifest(self):
        path = filedialog.askopenfilename(
            title="Open Manifest or Backup ZIP",
            filetypes=[
                ("Manifest or ZIP", "*.json *.zip"),
                ("JSON files", "*.json"),
                ("ZIP files", "*.zip"),
                ("All files", "*.*"),
            ],
        )
        if not path:
            return
        try:
            manifest = load_manifest(path)
            self.items = self.build_items(manifest)
        except Exception as exc:
            messagebox.showerror("Load Failed", str(exc))
            return
        self.current_path = path
        self.apply_filter()
        self.status_var.set(f"Loaded {len(self.items)} Perplexity-briefed books from {Path(path).name}.")

    def build_items(self, manifest):
        items = []
        briefings = manifest["briefings"]
        for raw_book in manifest["books"]:
            book = sanitize_book(raw_book)
            if not book.get("id"):
                continue
            briefing = briefings.get(book["id"])
            if not isinstance(briefing, dict):
                continue
            model = str(briefing.get("model") or "").lower()
            if "perplexity" not in model:
                continue
            if not book.get("title"):
                continue
            items.append({"book": book, "briefing": briefing})
        if not items:
            raise RuntimeError("No books with Perplexity-generated briefings were found.")
        items.sort(key=lambda item: (item["book"].get("title", "").lower(), item["book"].get("author", "").lower()))
        return items

    def apply_filter(self):
        query = self.filter_var.get().strip().lower()
        self.book_list.delete(0, tk.END)
        self.filtered_indexes = []
        for index, item in enumerate(self.items):
            book = item["book"]
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

    def selected_item(self):
        selection = self.book_list.curselection()
        if not selection:
            return None
        return self.items[self.filtered_indexes[selection[0]]]

    def active_spoiler_mode(self, briefing):
        if has_fiction_spoiler_pair(briefing):
            self.spoiler_mode_combo.configure(state="readonly")
            return self.spoiler_mode_var.get()
        self.spoiler_mode_var.set("safe")
        self.spoiler_mode_combo.configure(state="disabled")
        return "safe"

    def update_prompt_preview(self):
        self.prompt_text.delete("1.0", tk.END)
        item = self.selected_item()
        if not item:
            return
        book = item["book"]
        briefing = item["briefing"]
        spoiler_mode = self.active_spoiler_mode(briefing)
        self.prompt_text.insert(
            tk.END,
            "\n\n".join(
                [
                    "Book Metadata",
                    json.dumps(book, indent=2, ensure_ascii=False),
                    "Briefing Metadata",
                    json.dumps(
                        {
                            "genre": briefing.get("genre", ""),
                            "model": briefing.get("model", ""),
                            "generated_at": briefing.get("generated_at", ""),
                            "spoiler_pair_available": has_fiction_spoiler_pair(briefing),
                            "spoiler_mode": spoiler_mode,
                        },
                        indent=2,
                        ensure_ascii=False,
                    ),
                    "Narration Prompt",
                    build_narration_prompt(book, briefing, spoiler_mode),
                ]
            ),
        )

    def set_script_text(self, text):
        self.script_text.delete("1.0", tk.END)
        self.script_text.insert(tk.END, text)

    def run_selected_script(self):
        self.update_prompt_preview()
        item = self.selected_item()
        if not item:
            messagebox.showinfo("Select a Book", "Choose a book first.")
            return
        api_key = self.gemini_key_var.get().strip()
        if not api_key:
            messagebox.showerror("Missing API Key", "Enter GEMINI_API_KEY.")
            return
        self.log_path = Path(self.log_var.get().strip() or DEFAULT_LOG_PATH)
        save_local_config({
            "gemini_api_key": api_key,
            "log_path": str(self.log_path),
        })
        book = item["book"]
        briefing = item["briefing"]
        spoiler_mode = self.active_spoiler_mode(briefing)
        self.status_var.set(f'Generating narration script for "{book.get("title", "")}"...')
        self.set_script_text("Generating...")
        threading.Thread(
            target=self._run_script_worker,
            args=(book, briefing, spoiler_mode, api_key, build_narration_prompt(book, briefing, spoiler_mode)),
            daemon=True,
        ).start()

    def _run_script_worker(self, book, briefing, spoiler_mode, api_key, prompt_text):
        try:
            script, model_name = generate_narration_script(book, briefing, spoiler_mode, api_key)
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(make_log_entry(book, briefing, spoiler_mode, model_name, prompt_text, script))
            self.root.after(0, lambda: self._on_script_success(book, script, model_name))
        except Exception as exc:
            self.root.after(0, lambda: self._on_script_error(str(exc)))

    def _on_script_success(self, book, script, model_name):
        self.set_script_text(script)
        self.status_var.set(f'Script ready for "{book.get("title", "")}" via {model_name}. Characters: {len(script)}. Logged to {self.log_path.name}.')

    def _on_script_error(self, message):
        self.set_script_text(f"Error:\n{message}")
        self.status_var.set("Script generation failed.")
        messagebox.showerror("Script Generation Failed", message)


def main():
    root = tk.Tk()
    app = BriefingScriptTesterApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
