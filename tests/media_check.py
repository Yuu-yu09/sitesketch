"""Checks the media upload path end to end: upload -> list -> public URL -> delete."""

import io
import json
import sys
import time

import requests
from PIL import Image, ImageDraw

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/")

stamp = int(time.time())
email = f"media_{stamp}@example.com"
created = requests.post(
    f"{BASE}/api/auth/register",
    json={"username": f"media_{stamp}", "email": email, "password": "chicken-karewa1"},
    timeout=30,
).json()
token = created["token"]
headers = {"Authorization": f"Bearer {token}"}
print(f"registered {email}")

image = Image.new("RGB", (640, 420), "#1d4ed8")
ImageDraw.Draw(image).ellipse((240, 130, 400, 290), fill="#FFE95C")
buffer = io.BytesIO()
image.save(buffer, format="PNG")
buffer.seek(0)

up = requests.post(
    f"{BASE}/api/media",
    headers=headers,
    files={"file": ("my-photo.png", buffer.getvalue(), "image/png")},
    timeout=90,
)
print("upload ->", up.status_code, json.dumps(up.json())[:160])
assert up.status_code == 201, up.text

url = up.json()["url"]
public = requests.get(url, timeout=45)
print(f"public url -> {public.status_code}, {len(public.content)} bytes, {public.headers.get('content-type')}")
assert public.status_code == 200, public.text[:200]

listed = requests.get(f"{BASE}/api/media", headers=headers, timeout=30).json()
print("library ->", len(listed), "item(s)")
assert any(item["url"] == url for item in listed), listed

rejected = requests.post(
    f"{BASE}/api/media",
    headers=headers,
    files={"file": ("notes.txt", b"not an image", "text/plain")},
    timeout=30,
)
print("rejects a non-image ->", rejected.status_code)
assert rejected.status_code == 415, rejected.text

anonymous = requests.post(f"{BASE}/api/media", files={"file": ("x.png", b"x", "image/png")}, timeout=30)
print("rejects an anonymous upload ->", anonymous.status_code)
assert anonymous.status_code == 401, anonymous.text

removed = requests.delete(f"{BASE}/api/media/{up.json()['id']}", headers=headers, timeout=30)
print("delete ->", removed.status_code)
assert removed.status_code == 200, removed.text

gone = requests.get(url, timeout=30)
print("public url after delete ->", gone.status_code)

requests.delete(f"{BASE}/api/auth/me", headers=headers, timeout=10)  # not an endpoint; ignore
print("\nmedia path OK")