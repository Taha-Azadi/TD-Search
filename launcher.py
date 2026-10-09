from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox

import proxy_server

APP_NAME = "TD Search"
PORT = 8080
URL = f"http://127.0.0.1:{PORT}"
CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "TD-Search"
CONFIG_FILE = CONFIG_DIR / "settings.json"


def resource_path(relative: str) -> str:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return str(base / relative)


def read_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"setup_completed": False, "serpapi_key": "", "openrouter_key": ""}


def save_config(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


class SetupWindow(ctk.CTk):
    def __init__(self, config: dict):
        super().__init__()
        self.config_data = config
        self.result = None
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        self.title("TD Search — First-time setup")
        self.geometry("570x500")
        self.minsize(520, 460)
        self.configure(fg_color="#0b1120")
        self.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(self, text="TD Search", font=ctk.CTkFont(size=30, weight="bold"), text_color="#60a5fa").grid(row=0, column=0, pady=(25, 4))
        ctk.CTkLabel(self, text="Configure online search and AI — or skip for now.", text_color="#cbd5e1", wraplength=480).grid(row=1, column=0, padx=24, pady=(0, 22))

        ctk.CTkLabel(self, text="SerpAPI key  ·  Web / Images / News / Videos / Maps", anchor="w").grid(row=2, column=0, sticky="ew", padx=34, pady=(4, 5))
        self.serp = ctk.CTkEntry(self, placeholder_text="Optional: paste SerpAPI key", show="•", height=38)
        self.serp.grid(row=3, column=0, sticky="ew", padx=34)
        if config.get("serpapi_key"):
            self.serp.insert(0, config["serpapi_key"])

        ctk.CTkLabel(self, text="OpenRouter key  ·  AI answers", anchor="w").grid(row=4, column=0, sticky="ew", padx=34, pady=(18, 5))
        self.or_key = ctk.CTkEntry(self, placeholder_text="Optional: paste OpenRouter key", show="•", height=38)
        self.or_key.grid(row=5, column=0, sticky="ew", padx=34)
        if config.get("openrouter_key"):
            self.or_key.insert(0, config["openrouter_key"])

        ctk.CTkLabel(self, text="Keys are stored in your Windows user profile. You can leave either field empty.", text_color="#94a3b8", wraplength=475).grid(row=6, column=0, padx=30, pady=(15, 8))
        buttons = ctk.CTkFrame(self, fg_color="transparent")
        buttons.grid(row=7, column=0, sticky="ew", padx=34, pady=(10, 24))
        buttons.grid_columnconfigure((0, 1), weight=1)
        ctk.CTkButton(buttons, text="Skip for now", fg_color="#263449", hover_color="#34465e", height=42, command=self.skip).grid(row=0, column=0, sticky="ew", padx=(0, 7))
        ctk.CTkButton(buttons, text="Save & Launch", height=42, command=self.save_and_launch).grid(row=0, column=1, sticky="ew", padx=(7, 0))
        self.protocol("WM_DELETE_WINDOW", self.skip)

    def save_and_launch(self):
        self.result = {"setup_completed": True, "serpapi_key": self.serp.get().strip(), "openrouter_key": self.or_key.get().strip()}
        self.destroy()

    def skip(self):
        self.result = {"setup_completed": True, "serpapi_key": "", "openrouter_key": ""}
        self.destroy()


def wait_for_server(timeout: float = 12) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(URL + "/api/health", timeout=0.6) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def start_server(config: dict) -> None:
    # proxy_server.main() parses sys.argv, so pass its arguments explicitly.
    sys.argv = ["proxy_server.py", "--port", str(PORT), "--dir", resource_path("."),
                "--key", config.get("serpapi_key", ""),
                "--openrouter", config.get("openrouter_key", "")]
    proxy_server.main()


def main() -> None:
    config = read_config()
    if not config.get("setup_completed"):
        setup = SetupWindow(config)
        setup.mainloop()
        if not setup.result:
            return
        config = setup.result
        save_config(config)

    # Avoid silently failing if another instance already occupies the port.
    try:
        with urllib.request.urlopen(URL + "/api/health", timeout=1) as response:
            if response.status == 200:
                webbrowser.open(URL)
                return
    except Exception:
        pass

    thread = threading.Thread(target=start_server, args=(config,), daemon=True)
    thread.start()
    if wait_for_server():
        webbrowser.open(URL)
        # Keep the EXE alive while the local web server is running.
        try:
            while thread.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        messagebox.showerror(APP_NAME, "Could not start the local server. Port 8080 may already be in use.")


if __name__ == "__main__":
    main()
