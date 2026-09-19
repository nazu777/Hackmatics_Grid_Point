"""
Vercel Serverless Adapter for GridPoint FastAPI Backend
Exposes FastAPI app as Vercel Python serverless function.

Vercel expects an `app` variable (ASGI) in api/index.py.
Backend source is copied into api/src/ at build time so all imports resolve locally.
"""
import sys
import os

# Ensure api/ directory is on sys.path so 'from src.api import app' resolves
API_DIR = os.path.dirname(os.path.abspath(__file__))
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from src.api import app  # noqa: E402 - import after path setup

# For local testing with `vercel dev`, expose handler compat
try:
    from mangum import Mangum
    handler = Mangum(app)
except ImportError:
    handler = app
