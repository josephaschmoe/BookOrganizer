`briefing_compare_gui.py`

Local Windows Tkinter tool for comparing TomeShelf book briefing output from:
- `perplexity-sonar`
- `perplexity-sonar-pro`

What it does:
- loads a TomeShelf backup `.zip` export or legacy `.json` export
- lists books from the export
- sends the selected book to both Perplexity models using the current production app prompt
- displays results side by side
- appends each comparison to a local log file

Run:

```powershell
cd "C:\_George\Antigravity Playground\BookOrganizer"
python .\tools\briefing_compare_gui.py
```

If `python` is not on PATH, use your local Python launcher instead.

API key:
- enter it in the GUI, or
- set `PERPLEXITY_API_KEY`

Notes:
- the tool uses the same metadata fields as the app briefing generator:
  - title
  - author
  - year
  - publisher
  - edition
  - isbn
  - subjects
  - notes
- both sides use the same production prompt and system prompt
- the left pane uses `sonar`
- the right pane uses `sonar-pro`
- default output budget in the tool is `2500` tokens per side
- the log includes:
  - book metadata
  - left/right system and user prompts
  - left/right request payloads
  - left/right result JSON
