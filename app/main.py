import os
import re
import uuid
import sqlite3
from itertools import combinations
from pathlib import Path
from contextlib import closing
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

# --- Directory & Environment Configuration ---
ROOT_DIR = Path(__file__).resolve().parent.parent
env_path = ROOT_DIR / '.env'
persona_path = ROOT_DIR / 'persona.md'
db_path = ROOT_DIR / 'nagi.db'

load_dotenv(dotenv_path=env_path)

api_key = os.getenv("API_KEY")
if not api_key:
    raise ValueError("API_KEY is missing from .env")

model_name = os.getenv("MODEL_NAME", "gpt-4o-mini")
base_url = os.getenv("BASE_URL", None)
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", 20))

client_kwargs = {"api_key": api_key}
if base_url:
    client_kwargs["base_url"] = base_url

client = OpenAI(**client_kwargs)
app = FastAPI(title="Nagi Agent Wrapper")


# --- Database Setup & Connection Helper ---
def init_db():
    with closing(sqlite3.connect(db_path)) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                is_pinned INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'subsec'))
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                timestamp TEXT DEFAULT (datetime('now', 'subsec')),
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_searches (
                query TEXT PRIMARY KEY,
                context_note TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'subsec'))
            )
        """)
        # Self-heal: remove empty orphaned assistant messages from failed requests
        cursor.execute("DELETE FROM messages WHERE role = 'assistant' AND content = ''")
        conn.commit()

init_db()

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


# --- Pydantic Request Schemas ---
class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    create_new: bool = False

class UpdateSessionRequest(BaseModel):
    title: str | None = None
    is_pinned: int | None = None

class ForkRequest(BaseModel):
    message_id: int

class RetryRequest(BaseModel):
    message_id: int

class SavedSearchRequest(BaseModel):
    query: str
    context_note: str | None = None


# --- Core Business Logic & Persona Helpers ---
def load_persona() -> str:
    if persona_path.exists():
        return persona_path.read_text(encoding="utf-8")
    return "You are Nagi, a minimalist, sharp, and helpful AI companion."

def build_messages_payload(conn: sqlite3.Connection, session_id: str, latest_user_msg: str = "") -> list[dict]:
    """Builds the OpenAI-format message list, combining Macro session title matching and Micro @tag inline context injection."""
    session_row = conn.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
    session_title = (session_row["title"] or "").lower() if session_row else ""

    saved_searches = conn.execute(
        "SELECT query, context_note FROM saved_searches WHERE context_note != '' AND context_note IS NOT NULL"
    ).fetchall()
    
    matching_contexts = []
    seen_queries = set()

    # 1. Macro Layer: Match saved search queries in session title
    for search in saved_searches:
        q_term = search["query"].lower()
        if q_term and q_term in session_title and search["query"] not in seen_queries:
            matching_contexts.append(f"Context for [{search['query']}]:\n{search['context_note']}")
            seen_queries.add(search["query"])

    # 2. Micro Layer: Check if any known saved search query is referenced via @ in the message
    if latest_user_msg:
        msg_lower = latest_user_msg.lower()
        for search in saved_searches:
            q_term = search["query"].lower()
            if q_term and f"@{q_term}" in msg_lower and search["query"] not in seen_queries:
                matching_contexts.append(f"Micro Synapse Context (@{search['query']}):\n{search['context_note']}")
                seen_queries.add(search["query"])

    base_persona = load_persona()
    if matching_contexts:
        combined_context = "\n\n---\n".join(matching_contexts)
        system_content = f"{base_persona}\n\nRelevant Workspace Context Notes:\n{combined_context}"
    else:
        system_content = base_persona

    history_rows = conn.execute("""
        SELECT role, content FROM (
            SELECT role, content, timestamp FROM messages
            WHERE session_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        ) ORDER BY timestamp ASC
    """, (session_id, MAX_CONTEXT_MESSAGES)).fetchall()

    messages_payload = [{"role": "system", "content": system_content}]
    for row in history_rows:
        role = "user" if row["role"] == "user" else "assistant"
        messages_payload.append({"role": role, "content": row["content"]})
    return messages_payload

def stream_completion(session_id: str, messages_payload: list[dict]) -> StreamingResponse:
    """
    Reserves an empty assistant row up front so its ID can be returned immediately,
    streams completion chunks, and updates or cleans up the database row upon completion.
    """
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'assistant', '', datetime('now', 'subsec'))",
            (session_id,)
        )
        message_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages_payload,
            stream=True,
        )
    except Exception as e:
        cleanup_conn = get_db_connection()
        try:
            cleanup_conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
            cleanup_conn.commit()
        finally:
            cleanup_conn.close()
        raise HTTPException(status_code=500, detail=str(e))

    def generate():
        full_reply = ""
        try:
            for chunk in response:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_reply += delta
                    yield delta
        except Exception as stream_err:
            error_msg = f"\n[Stream Error: {str(stream_err)}]"
            full_reply += error_msg
            yield error_msg
        finally:
            save_conn = get_db_connection()
            try:
                if full_reply:
                    save_conn.execute("UPDATE messages SET content = ? WHERE id = ?", (full_reply, message_id))
                else:
                    save_conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
                save_conn.commit()
            finally:
                save_conn.close()

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={"X-Message-Id": str(message_id)}
    )


# --- API Endpoints: Sessions & Graph ---
@app.get("/api/sessions")
async def list_sessions():
    with closing(get_db_connection()) as conn:
        sessions = conn.execute("""
            SELECT s.id, s.title, s.is_pinned, s.created_at, MAX(CASE WHEN m.role = 'user' THEN m.timestamp END) as last_user_activity
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            GROUP BY s.id
            ORDER BY s.is_pinned DESC, COALESCE(MAX(CASE WHEN m.role = 'user' THEN m.timestamp END), s.created_at) DESC
        """).fetchall()
        return [dict(s) for s in sessions]

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
    "how", "what", "my", "me", "i", "it", "this", "that", "can", "you", "fork",
}

def title_words(title: str | None) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (title or "").lower())
    return {w for w in words if len(w) > 1 and w not in STOPWORDS}

@app.get("/api/graph")
async def get_graph():
    """Links every pair of chats whose titles share a word. Weight = shared words count."""
    with closing(get_db_connection()) as conn:
        sessions = conn.execute("SELECT id, title, is_pinned FROM sessions").fetchall()

    words = {s["id"]: title_words(s["title"]) for s in sessions}
    edges = []
    for a, b in combinations(sessions, 2):
        shared = len(words[a["id"]] & words[b["id"]])
        if shared:
            edges.append({"source": a["id"], "target": b["id"], "weight": shared})

    nodes = [{"id": s["id"], "title": s["title"] or "Untitled", "is_pinned": s["is_pinned"]} for s in sessions]
    return {"nodes": nodes, "edges": edges}

@app.get("/api/sessions/{session_id}")
async def get_session_messages(session_id: str):
    with closing(get_db_connection()) as conn:
        messages = conn.execute("SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
        return [dict(m) for m in messages]

@app.put("/api/sessions/{session_id}")
async def update_session(session_id: str, request: UpdateSessionRequest):
    with closing(get_db_connection()) as conn:
        cursor = conn.cursor()
        if request.title is not None:
            cursor.execute("UPDATE sessions SET title = ? WHERE id = ?", (request.title, session_id))
        if request.is_pinned is not None:
            cursor.execute("UPDATE sessions SET is_pinned = ? WHERE id = ?", (request.is_pinned, session_id))
        conn.commit()
    return {"status": "success"}

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    with closing(get_db_connection()) as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
    return {"status": "success"}


# --- API Endpoints: Saved Searches & Contexts ---
@app.get("/api/searches")
async def get_saved_searches():
    with closing(get_db_connection()) as conn:
        rows = conn.execute("SELECT query, context_note FROM saved_searches ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

@app.post("/api/searches")
async def save_search_pill(request: SavedSearchRequest):
    with closing(get_db_connection()) as conn:
        conn.execute("""
            INSERT INTO saved_searches (query, context_note) VALUES (?, ?)
            ON CONFLICT(query) DO UPDATE SET context_note = COALESCE(?, context_note)
        """, (request.query, request.context_note, request.context_note))
        conn.commit()
    return {"status": "success"}

@app.delete("/api/searches/{query}")
async def delete_search_pill(query: str):
    with closing(get_db_connection()) as conn:
        conn.execute("DELETE FROM saved_searches WHERE query = ?", (query,))
        conn.commit()
    return {"status": "success"}


# --- API Endpoints: Fork, Retry & Chat ---
@app.post("/api/sessions/{session_id}/fork")
async def fork_session(session_id: str, request: ForkRequest):
    with closing(get_db_connection()) as conn:
        target_msg = conn.execute(
            "SELECT timestamp, role, content FROM messages WHERE id = ? AND session_id = ?", 
            (request.message_id, session_id)
        ).fetchone()
        
        if not target_msg:
            raise HTTPException(status_code=404, detail="Target message not found")
        if target_msg["role"] != "assistant":
            raise HTTPException(status_code=400, detail="Can only fork from assistant messages")

        target_timestamp = target_msg["timestamp"]
        preview_text = target_msg["content"][:30] + ("..." if len(target_msg["content"]) > 30 else "")
        new_title = f"Fork: {preview_text}"
        new_session_id = str(uuid.uuid4())

        conn.execute("INSERT INTO sessions (id, title, is_pinned, created_at) VALUES (?, ?, 0, datetime('now', 'subsec'))", (new_session_id, new_title))
        conn.execute("""
            INSERT INTO messages (session_id, role, content, timestamp)
            SELECT ?, role, content, timestamp
            FROM messages
            WHERE session_id = ? AND timestamp <= ?
            ORDER BY timestamp ASC
        """, (new_session_id, session_id, target_timestamp))
        conn.commit()

    return {"new_session_id": new_session_id, "title": new_title}

@app.post("/api/sessions/{session_id}/retry")
async def retry_message(session_id: str, request: RetryRequest):
    try:
        with closing(get_db_connection()) as conn:
            target = conn.execute(
                "SELECT role, timestamp FROM messages WHERE id = ? AND session_id = ?",
                (request.message_id, session_id)
            ).fetchone()

            if not target:
                raise HTTPException(status_code=404, detail="Message not found")
            if target["role"] != "assistant":
                raise HTTPException(status_code=400, detail="Can only retry an assistant message")

            conn.execute(
                "DELETE FROM messages WHERE session_id = ? AND timestamp >= ?",
                (session_id, target["timestamp"])
            )
            conn.commit()

            last_user_msg_row = conn.execute(
                "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp DESC LIMIT 1",
                (session_id,)
            ).fetchone()
            last_user_msg = last_user_msg_row["content"] if last_user_msg_row else ""

            messages_payload = build_messages_payload(conn, session_id, latest_user_msg=last_user_msg)

        return stream_completion(session_id, messages_payload)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        with closing(get_db_connection()) as conn:
            session_id = request.session_id or str(uuid.uuid4())

            exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not exists:
                title = request.message[:30] + ("..." if len(request.message) > 30 else "")
                conn.execute("INSERT INTO sessions (id, title, is_pinned, created_at) VALUES (?, ?, 0, datetime('now', 'subsec'))", (session_id, title))
                conn.commit()

            conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, datetime('now', 'subsec'))", (session_id, "user", request.message))
            conn.commit()

            messages_payload = build_messages_payload(conn, session_id, latest_user_msg=request.message)

        return stream_completion(session_id, messages_payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Static File Mounting ---
static_dir = ROOT_DIR / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")