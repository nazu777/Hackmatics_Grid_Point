"""
Vercel Serverless Adapter for GridPoint FastAPI Backend
Exposes FastAPI app as Vercel Python serverless function.

Vercel expects an `app` variable (ASGI) in api/index.py.
Path handling adds backend/ to sys.path so `from src.api import app` works
both locally and on Vercel.
"""
import sys
import os

# Add backend directory to Python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Also add root for shared modules
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.api import app  # noqa: E402 - import after path setup

# Vercel's Python runtime looks for `app` or `handler`
# FastAPI app is ASGI, Vercel handles it natively since 2023
# No Mangum wrapper needed for modern runtime

# For local testing with `vercel dev`, expose handler compat
try:
    from mangum import Mangum
    handler = Mangum(app)
except ImportError:
    handler = app
