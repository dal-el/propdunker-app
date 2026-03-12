
import tkinter as tk
from tkinter import filedialog, messagebox
from pathlib import Path
from process_selected import process_files

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PropDunker — Bookmaker JSON Processor (NOVIBET)")
        self.geometry("820x520")
        self.resizable(False, False)

        self.files = []

        tk.Label(self, text="Select one or more raw NOVIBET JSON files. When ready, press FINISHED.", font=("Segoe UI", 12)).pack(pady=12)

        top = tk.Frame(self)
        top.pack(pady=6)

        tk.Button(top, text="Add JSONs…", width=16, command=self.add_files).grid(row=0, column=0, padx=6)
        tk.Button(top, text="Select All", width=16, command=self.select_all).grid(row=0, column=1, padx=6)
        tk.Button(top, text="Clear", width=16, command=self.clear).grid(row=0, column=2, padx=6)
        tk.Button(top, text="FINISHED", width=16, command=self.run).grid(row=0, column=3, padx=6)

        mid = tk.Frame(self)
        mid.pack(pady=10)

        self.listbox = tk.Listbox(mid, width=120, height=18, selectmode=tk.EXTENDED)
        self.listbox.pack(side=tk.LEFT)

        sb = tk.Scrollbar(mid, orient="vertical", command=self.listbox.yview)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self.listbox.configure(yscrollcommand=sb.set)

        self.status = tk.Label(self, text="", font=("Segoe UI", 10))
        self.status.pack(pady=8)

    def add_files(self):
        paths = filedialog.askopenfilenames(
            title="Select raw NOVIBET JSON files",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if not paths:
            return
        for p in paths:
            pp = str(Path(p).resolve())
            if pp not in [str(x) for x in self.files]:
                self.files.append(Path(pp))
                self.listbox.insert(tk.END, pp)
        self.status.config(text=f"{len(self.files)} file(s) loaded.")

    def select_all(self):
        if self.listbox.size() == 0:
            return
        self.listbox.selection_set(0, tk.END)

    def clear(self):
        self.files = []
        self.listbox.delete(0, tk.END)
        self.status.config(text="Cleared.")

    def run(self):
        if not self.files:
            messagebox.showerror("Error", "Add at least one JSON file first.")
            return
        sel = self.listbox.curselection()
        chosen = [str(self.files[i]) for i in sel] if sel else [str(p) for p in self.files]
        try:
            out_dir = process_files(chosen)
            messagebox.showinfo("Done", f"Processed OK\nOutput: {out_dir}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

if __name__ == "__main__":
    App().mainloop()
