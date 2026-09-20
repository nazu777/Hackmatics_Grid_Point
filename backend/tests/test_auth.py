"""Tests for JWT auth endpoints (backend-only auth)."""
from fastapi.testclient import TestClient
from src.api import app
from src import auth as auth_module

client = TestClient(app)


def setup_function(_):
    auth_module.clear_users()


def test_signup_login_me_flow():
    r = client.post("/api/auth/signup", json={
        "name": "Demo User", "email": "demo@example.com", "password": "password123"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert r.json()["user"]["email"] == "demo@example.com"

    r2 = client.post("/api/auth/login", json={
        "email": "demo@example.com", "password": "password123"})
    assert r2.status_code == 200

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "demo@example.com"


def test_signup_duplicate_and_validation():
    client.post("/api/auth/signup", json={
        "name": "A", "email": "dup@example.com", "password": "password123"})
    dup = client.post("/api/auth/signup", json={
        "name": "B", "email": "dup@example.com", "password": "password123"})
    assert dup.status_code == 409

    short = client.post("/api/auth/signup", json={
        "name": "C", "email": "c@example.com", "password": "short"})
    assert short.status_code == 400

    bad_email = client.post("/api/auth/signup", json={
        "name": "D", "email": "not-an-email", "password": "password123"})
    assert bad_email.status_code == 400


def test_login_wrong_password_and_me_no_token():
    client.post("/api/auth/signup", json={
        "name": "E", "email": "e@example.com", "password": "password123"})
    bad = client.post("/api/auth/login", json={
        "email": "e@example.com", "password": "wrongpass1"})
    assert bad.status_code == 401

    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me",
                      headers={"Authorization": "Bearer invalid.token.here"}).status_code == 401
