import os
import sys
import uuid
import sqlite3
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from prompt_toolkit import PromptSession
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.validation import Validator, ValidationError


class NotEmptyValidator(Validator):
    def validate(self, document):
        if not document.text.strip():
            raise ValidationError(message="", cursor_position=0)


class NagiCLI:
    def __init__(self):
        self.root_dir = Path(__file__).resolve().parent.parent
        load_dotenv(dotenv_path=self.root_dir / '.env')

        self.db_path = self.root_dir / 'nagi.db'
        self.persona_path = self.root_dir / 'persona.md'

        api_key = os.getenv("API_KEY")
        if not api_key:
            sys.exit("Error: API_KEY is missing from .env")

        self.model_name = os.getenv("MODEL_NAME")
        if not self.model_name:
            sys.exit("Error: MODEL_NAME is missing from .env")

        base_url = os.getenv("BASE_URL", None)
        self.max_context = int(os.getenv("MAX_CONTEXT_MESSAGES", 20))

        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        self.client = OpenAI(**client_kwargs)
        
        self.is_trusted = False
        self.workspace_context = ""
        self._init_db()

    def _check_vscode_trust(self):
        in_vscode = os.environ.get("TERM_PROGRAM") == "vscode" or "VSCODE_PID" in os.environ
        if not in_vscode or not sys.stdin.isatty():
            return

        scan_dir = Path.cwd()
        while True:
            try:
                choice = input(f"Do you trust the files in '{scan_dir.name}/'? (y/n): ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                print("\nExiting.")
                sys.exit(0)

            if choice in ('y', 'yes'):
                self.is_trusted = True
                file_contents = []
                ignore = {'.git', 'venv', '.venv', '__pycache__', 'node_modules', '.vscode', '.idea', 'dist', 'build'}
                valid_exts = {'.py', '.js', '.ts', '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.html', '.css', '.sql'}
                
                for p in scan_dir.rglob("*"):
                    if any(part in ignore for part in p.parts):
                        continue
                    if p.is_file() and not p.name.startswith('.') and p.suffix in valid_exts:
                        try:
                            content = p.read_text(encoding='utf-8')
                            rel_path = p.relative_to(scan_dir)
                            file_contents.append(f"=== File: {rel_path} ===\n{content}\n")
                        except Exception:
                            pass
                
                if file_contents:
                    self.workspace_context = f"\n\n[Current Working Directory: {scan_dir}]\n[VS Code Workspace File Contents]:\n" + "\n".join(file_contents[:30])
                print()
                break
            elif choice in ('n', 'no'):
                print()
                break
            print("Please enter 'y' or 'n'.")

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
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
        cursor.execute("DELETE FROM messages WHERE role = 'assistant' AND content = ''")
        conn.commit()
        conn.close()

    def _load_persona(self, session_id="") -> str:
        base_persona = self.persona_path.read_text(encoding="utf-8") if self.persona_path.exists() else "You are Nagi, a minimalist, sharp AI companion."
        
        search_context = ""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            session_title = ""
            if session_id:
                sess = cursor.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
                if sess and sess["title"]:
                    session_title = sess["title"]
            
            table_info = cursor.execute("PRAGMA table_info(saved_searches)").fetchall()
            col_names = [col[1] for col in table_info]
            
            if col_names:
                q_col = next((c for c in ['query', 'search_query', 'title', 'keyword'] if c in col_names), col_names[0])
                n_col = next((c for c in ['note', 'content', 'body', 'text'] if c in col_names), col_names[1] if len(col_names) > 1 else col_names[0])
                
                rows = cursor.execute(f"SELECT {q_col}, {n_col} FROM saved_searches").fetchall()
                for row in rows:
                    q = row[q_col]
                    note = row[n_col]
                    if q and session_title and str(q).lower() in session_title.lower():
                        search_context += f"\n\n[Saved Search Context for '{q}']: {note}"
            
            conn.close()
        except Exception:
            pass

        full_persona = base_persona + search_context
        return full_persona + self.workspace_context if self.is_trusted else full_persona

    def _print_banner(self):
        if not sys.stdout.isatty() or "NO_COLOR" in os.environ:
            print("\nNagi CLI\n  Ctrl+C or 'exit' to quit\n")
            return

        DIM, RESET = "\033[2m", "\033[0m"
        print()
        print("Nagi CLI")
        print(f"{DIM}Ctrl+C or 'exit' to quit{RESET}")
        print()

    def run(self):
        self._print_banner()
        self._check_vscode_trust()

        kb = KeyBindings()

        @kb.add("c-v")
        def _(e):
            clipboard_data = e.app.clipboard.get_data()
            if clipboard_data:
                e.current_buffer.insert_text(clipboard_data.text.replace("\r\n", "\n").replace("\r", "\n"))

        @kb.add("c-j")
        def _(e):
            e.current_buffer.insert_text("\n")

        @kb.add("c-u")
        def _(e):
            e.current_buffer.text = ""
            e.current_buffer.cursor_position = 0

        session = PromptSession(key_bindings=kb, validator=NotEmptyValidator(), validate_while_typing=False)

        session_id = str(uuid.uuid4())
        session_created = False

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        try:
            while True:
                try:
                    user_msg = session.prompt("You: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print("\nExiting.")
                    break

                if not user_msg:
                    continue
                if user_msg.lower() in ('exit', 'quit'):
                    print("Exiting.")
                    break

                print()

                if not session_created:
                    truncated = user_msg[:30] + ("..." if len(user_msg) > 30 else "")
                    title = f"CLI: {truncated}"
                    conn.execute(
                        "INSERT INTO sessions (id, title, is_pinned, created_at) VALUES (?, ?, 0, datetime('now', 'subsec'))",
                        (session_id, title)
                    )
                    conn.commit()
                    session_created = True

                conn.execute(
                    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', ?, datetime('now', 'subsec'))",
                    (session_id, user_msg)
                )
                conn.commit()

                history_rows = conn.execute("""
                    SELECT role, content FROM (
                        SELECT role, content, timestamp FROM messages
                        WHERE session_id = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    ) ORDER BY timestamp ASC
                """, (session_id, self.max_context)).fetchall()

                payload = [{"role": "system", "content": self._load_persona(session_id)}]
                for row in history_rows:
                    role = "user" if row["role"] == "user" else "assistant"
                    payload.append({"role": role, "content": row["content"]})

                print("Nagi: ", end="", flush=True)
                cursor = conn.execute(
                    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'assistant', '', datetime('now', 'subsec'))",
                    (session_id,)
                )
                msg_id = cursor.lastrowid
                conn.commit()

                full_reply = ""
                try:
                    response = self.client.chat.completions.create(
                        model=self.model_name, messages=payload, stream=True
                    )
                    for chunk in response:
                        delta = chunk.choices[0].delta.content
                        if delta:
                            full_reply += delta
                            print(delta, end="", flush=True)
                    print(end="\n\n")
                except Exception as e:
                    error_msg = f"\n[Stream Error: {e}]\n\n"
                    full_reply += error_msg
                    print(error_msg)

                if full_reply:
                    conn.execute("UPDATE messages SET content = ? WHERE id = ?", (full_reply.strip(), msg_id))
                else:
                    conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
                conn.commit()

        finally:
            conn.close()


if __name__ == "__main__":
    NagiCLI().run()