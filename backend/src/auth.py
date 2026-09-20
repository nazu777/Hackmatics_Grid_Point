"""
GridPoint Auth — lightweight JWT authentication (stdlib only, no extra deps).

Design notes:
- Password hashing: PBKDF2-HMAC-SHA256 with per-user salt (no bcrypt dependency,
  keeps Vercel serverless builds lean).
- Tokens: HS256 JWT signed with GRIDPOINT_JWT_SECRET (defaults to dev secret).
- Store: in-memory dict. Stateless serverless functions lose users across cold
  starts — for production, swap `_USERS` for Neon Postgres (see TODO below).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Dict, Optional, Tuple

JWT_SECRET = os.environ.get("GRIDPOINT_JWT_SECRET", "gridpoint-dev-secret-change-me")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = int(os.environ.get("GRIDPOINT_JWT_TTL", "86400"))  # 24h
PBKDF2_ITERATIONS = 210_000

# TODO(prod): replace with Neon Postgres users table.
#   CREATE TABLE users(id TEXT PK, name TEXT, email TEXT UNIQUE, pw_hash TEXT, created_at TIMESTAMPTZ)
_USERS: Dict[str, dict] = {}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, pw_hash: str) -> bool:
    try:
        algo, iters, salt, hex_digest = pw_hash.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iters))
        return hmac.compare_digest(dk.hex(), hex_digest)
    except Exception:
        return False


def create_access_token(user_id: str, email: str, ttl: int = TOKEN_TTL_SECONDS) -> str:
    header = _b64url_encode(json.dumps({"alg": JWT_ALGORITHM, "typ": "JWT"}).encode())
    now = int(time.time())
    payload = _b64url_encode(json.dumps({
        "sub": user_id, "email": email, "iat": now, "exp": now + ttl,
    }).encode())
    sig = _b64url_encode(hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def decode_token(token: str) -> Optional[dict]:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        expected = _b64url_encode(
            hmac.new(JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(expected, sig_b64):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def validate_signup(name: str, email: str, password: str) -> Optional[str]:
    if not name or not name.strip():
        return "Name is required"
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        return "Enter a valid email address"
    if len(password or "") < 8:
        return "Password must be at least 8 characters"
    return None


def signup_user(name: str, email: str, password: str) -> Tuple[Optional[dict], Optional[str]]:
    email = email.strip().lower()
    err = validate_signup(name, email, password)
    if err:
        return None, err
    if email in _USERS:
        return None, "An account with this email already exists"
    user = {
        "id": f"u_{secrets.token_hex(8)}",
        "name": name.strip(),
        "email": email,
        "pw_hash": hash_password(password),
        "created_at": int(time.time()),
    }
    _USERS[email] = user
    return user, None


def authenticate_user(email: str, password: str) -> Tuple[Optional[dict], Optional[str]]:
    email = (email or "").strip().lower()
    user = _USERS.get(email)
    if not user or not verify_password(password or "", user["pw_hash"]):
        return None, "Invalid email or password"
    return user, None


def public_user(user: dict) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


def clear_users() -> None:
    """Test helper — resets the in-memory store."""
    _USERS.clear()
