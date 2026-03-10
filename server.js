const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const PUBLIC_DIR = __dirname;
const CATALOG_DATA_PATH = path.join(__dirname, "catalog-data.json");

const researchSchema = {
  type: "object",
  properties: {
    quick_take: { type: "string" },
    plot_summary: { type: "string" },
    major_themes: { type: "array", items: { type: "string" } },
    character_focus: { type: "array", items: { type: "string" } },
    historical_context: { type: "string" },
    literary_analysis: { type: "string" },
    emotional_social_impact: { type: "string" },
    discussion_questions: { type: "array", items: { type: "string" } },
    confidence_note: { type: "string" }
  },
  required: [
    "quick_take",
    "plot_summary",
    "major_themes",
    "character_focus",
    "historical_context",
    "literary_analysis",
    "emotional_social_impact",
    "discussion_questions",
    "confidence_note"
  ]
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        researchEnabled: Boolean(process.env.GEMINI_API_KEY),
        catalogStorage: CATALOG_DATA_PATH
      });
    }

    if (req.method === "GET" && url.pathname === "/api/catalog") {
      return handleGetCatalog(res);
    }

    if (req.method === "POST" && url.pathname === "/api/catalog") {
      return handleSaveCatalog(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/research") {
      return handleResearch(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Book Organizer listening on http://localhost:${PORT}`);
});

function handleGetCatalog(res) {
  const data = readCatalogData();
  sendJson(res, 200, {
    books: data.books,
    researchCache: data.researchCache,
    storagePath: CATALOG_DATA_PATH
  });
}

async function handleSaveCatalog(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: "Invalid JSON request body." });
  }

  const data = normalizeCatalogPayload(body);
  try {
    writeCatalogData(data);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Unable to save catalog data." });
  }

  sendJson(res, 200, {
    ok: true,
    storagePath: CATALOG_DATA_PATH
  });
}

async function handleResearch(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return sendJson(res, 500, {
      error: "Missing GEMINI_API_KEY. Add it to a local .env file before generating research."
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: "Invalid JSON request body." });
  }

  const book = sanitizeBook(body && body.book);
  if (!book.title) {
    return sendJson(res, 400, { error: "Book title is required." });
  }

  const payload = {
    system_instruction: {
      parts: [
        {
          text: [
            "You are a precise literary discussion assistant.",
            "Create a college-level book discussion with spoilers allowed.",
            "Separate factual claims from interpretation when uncertainty exists.",
            "If the book is obscure, the title is ambiguous, or the details may be wrong, say so clearly in confidence_note.",
            "Return JSON only."
          ].join(" ")
        }
      ]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildPrompt(book) }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseJsonSchema: researchSchema,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  let geminiResponse;
  try {
    geminiResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return sendJson(res, 502, { error: "Unable to reach Gemini API." });
  }

  const rawText = await geminiResponse.text();
  if (!geminiResponse.ok) {
    return sendJson(res, geminiResponse.status, {
      error: "Gemini request failed.",
      details: safeParseJson(rawText)
    });
  }

  let parsedApi;
  try {
    parsedApi = JSON.parse(rawText);
  } catch (error) {
    return sendJson(res, 502, { error: "Gemini returned unreadable JSON." });
  }

  const candidateText = extractCandidateText(parsedApi);
  let research;
  try {
    research = parseResearchJson(candidateText);
  } catch (error) {
    return sendJson(res, 502, { error: "Gemini returned malformed research JSON." });
  }

  research.generated_at = new Date().toISOString();
  research.model = MODEL;
  sendJson(res, 200, { research });
}

function buildPrompt(book) {
  return [
    "Create a structured, college-level book briefing with spoilers allowed.",
    "Write as though leading a strong classroom or book club discussion.",
    "Use the supplied metadata only as guidance; do not invent certainty.",
    "",
    "Book metadata:",
    `Title: ${book.title || "Unknown"}`,
    `Author: ${book.author || "Unknown"}`,
    `Year: ${book.year || "Unknown"}`,
    `Publisher: ${book.publisher || "Unknown"}`,
    `Edition: ${book.edition || "Unknown"}`,
    `ISBN: ${book.isbn || "Unknown"}`,
    `Subjects: ${book.subjects || "Unknown"}`,
    `Notes: ${book.notes || "None"}`,
    "",
    "Return valid JSON with these fields:",
    "quick_take: 2 to 4 sentences.",
    "plot_summary: a spoiler-friendly summary in one or two paragraphs.",
    "major_themes: 3 to 6 concise bullet-style strings.",
    "character_focus: 3 to 6 concise bullet-style strings.",
    "historical_context: one paragraph.",
    "literary_analysis: one or two paragraphs about style, structure, symbols, or technique.",
    "emotional_social_impact: one paragraph on why the work matters and how it lands.",
    "discussion_questions: 6 strong seminar questions.",
    "confidence_note: mention ambiguity, factual uncertainty, or edition limits when relevant."
  ].join("\n");
}

function sanitizeBook(book) {
  const source = book && typeof book === "object" ? book : {};
  return {
    title: cleanText(source.title),
    author: cleanText(source.author),
    year: cleanText(source.year),
    publisher: cleanText(source.publisher),
    edition: cleanText(source.edition),
    isbn: cleanText(source.isbn),
    subjects: cleanText(source.subjects),
    notes: cleanText(source.notes)
  };
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 600);
}

function normalizeCatalogPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    books: Array.isArray(source.books) ? source.books : [],
    researchCache: isPlainObject(source.researchCache) ? source.researchCache : {}
  };
}

function readCatalogData() {
  if (!fs.existsSync(CATALOG_DATA_PATH)) {
    return { books: [], researchCache: {} };
  }

  try {
    const raw = fs.readFileSync(CATALOG_DATA_PATH, "utf8");
    return normalizeCatalogPayload(raw ? JSON.parse(raw) : {});
  } catch (error) {
    console.error("Unable to read catalog data.", error);
    return { books: [], researchCache: {} };
  }
}

function writeCatalogData(data) {
  fs.writeFileSync(CATALOG_DATA_PATH, JSON.stringify(normalizeCatalogPayload(data), null, 2) + "\n", "utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractCandidateText(data) {
  const parts = (((data || {}).candidates || [])[0] || {}).content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) {
    throw new Error("No candidate text.");
  }
  return text;
}

function parseResearchJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw error;
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      resolve(data ? JSON.parse(data) : {});
    });
    req.on("error", reject);
  });
}

function serveStatic(requestPath, res) {
  let filePath = requestPath === "/" ? "/book-catalog.html" : requestPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, filePath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden." });
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found.");
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error.");
      return;
    }

    res.writeHead(200, { "Content-Type": contentTypeFor(absolutePath) });
    res.end(data);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "text/plain; charset=utf-8";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}