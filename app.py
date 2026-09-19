"""
Root entry point for GridPoint Streamlit Application.
Delegates to backend/app.py.
"""
import sys
import os

# Add backend directory to sys.path so src imports work seamlessly
backend_dir = os.path.join(os.path.dirname(__file__), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Execute backend/app.py
with open(os.path.join(backend_dir, "app.py"), "r") as f:
    code = compile(f.read(), os.path.join(backend_dir, "app.py"), "exec")
    exec(code)
