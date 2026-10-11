"""
Media library: images the user picks or uploads.

Uploads go to the Supabase Storage bucket `media` and are served from the
public CDN URL. The curated library (DESIGN.IMAGES in the browser) needs no
backend at all - only the user's own files come through here.
"""

from __future__ import annotations

import base64
import binascii
import pathlib
import uuid

import requests
from flask import Blueprint, Blueprint as _Bp, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

import config
import db

bp = Blueprint("media", __name__, url_prefix="/api/media")

MEDIA_BUCKET = "media"

# what a browser can upload: keeps the bucket from turning into junk storage
ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_BYTES = 6 * 1024 * 1024      # 6 MB - plenty for a photo, small enough for a function


def ensure_bucket() -> None:
    """Create the public media bucket if it does not exist yet."""
    if not config.SUPABASE_URL or not config.SUPABASE_KEY:
        return
    headers = {"apikey": config.SUPABASE_KEY, "Authorization": f"Bearer {config.SUPABASE_KEY}"}
    url = f"{config.SUPABASE_URL}/storage/v1/bucket/{MEDIA_BUCKET}"
    response = requests.get(url, headers=headers, timeout=20)
    if response.status_code == 200:
        return
    requests.post(
        f"{config.SUPABASE_URL}/storage/v1/bucket",
        headers={**headers, "Content-Type": "application/json"},
        json={"id": MEDIA_BUCKET, "name": MEDIA_BUCKET, "public": True},
        timeout=20,
    )


@bp.get("")
@jwt_required()
def index():
    """List this user's own uploads."""
    rows = db.query(
        "select id, name, path, url, created_at from media"
        " where user_id = %s::uuid order by created_at desc limit 60",
        (get_jwt_identity(),),
    )
    return jsonify([
        {
            "id": str(row["id"]),
            "name": row["name"],
            "url": row["url"],
            "created_at": int(row["created_at"].timestamp() * 1000),
        }
        for row in rows
    ])


@bp.post("")
@jwt_required()
def upload():
    """
    Upload one image.

    Accepts either a multipart file (what the browser sends) or JSON with a
    base64 data URL. Returns the public URL to drop straight into a section.
    """
    if not config.SUPABASE_URL or not config.SUPABASE_KEY:
        return jsonify(error="Storage is not configured on this server"), 503

    filename, mime, blob = _read_upload()
    if blob is None:
        return jsonify(error="Send an image file"), 400
    if mime not in ALLOWED:
        return jsonify(error="Use a JPG, PNG, WebP or GIF image"), 415
    if len(blob) > MAX_BYTES:
        return jsonify(error="Images must be under 6 MB"), 413

    extension = ALLOWED[mime]
    key = f"{get_jwt_identity()}/{uuid.uuid4().hex}{extension}"
    ensure_bucket()

    response = requests.post(
        f"{config.SUPABASE_URL}/storage/v1/object/{MEDIA_BUCKET}/{key}",
        headers={
            "apikey": config.SUPABASE_KEY,
            "Authorization": f"Bearer {config.SUPABASE_KEY}",
            "Content-Type": mime,
            "x-upsert": "true",
        },
        data=blob,
        timeout=45,
    )
    if response.status_code not in (200, 201):
        return jsonify(error="Upload failed", detail=response.text[:160]), 502

    url = f"{config.SUPABASE_URL}/storage/v1/object/public/{MEDIA_BUCKET}/{key}"
    name = filename or f"image{extension}"
    row = db.query_one(
        "insert into media (user_id, name, path, url, content_type, size_bytes)"
        " values (%s::uuid, %s, %s, %s, %s, %s) returning id, name, url, created_at",
        (get_jwt_identity(), name[:80], key, url, mime, len(blob)),
    )

    return jsonify(
        url=url,
        name=row["name"],
        id=str(row["id"]),
        bytes=len(blob),
    ), 201


@bp.delete("/<mid>")
@jwt_required()
def destroy(mid: str):
    """Remove an upload from storage and the table."""
    row = db.query_one(
        "select id, path from media where id = %s::uuid and user_id = %s::uuid",
        (mid, get_jwt_identity()),
    )
    if not row:
        return jsonify(error="Not found"), 404

    if config.SUPABASE_URL and config.SUPABASE_KEY:
        headers = {"apikey": config.SUPABASE_KEY, "Authorization": f"Bearer {config.SUPABASE_KEY}"}
        requests.delete(
            f"{config.SUPABASE_URL}/storage/v1/object/{MEDIA_BUCKET}/{row['path']}",
            headers=headers, timeout=20,
        )
    db.query_one("delete from media where id = %s::uuid returning id", (mid,))
    return jsonify(ok=True)


def _read_upload():
    """Pull (filename, mime, bytes) out of either multipart or JSON."""
    if "multipart/form-data" in (request.content_type or ""):
        file = request.files.get("file")
        if not file or not file.filename:
            return None, None, None
        return file.filename, file.mimetype, file.read()

    body = request.get_json(silent=True) or {}
    data_url = body.get("data") or body.get("url") or ""
    if not data_url.startswith("data:"):
        return body.get("name"), body.get("mime"), None

    try:
        header, encoded = data_url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "")
        return body.get("name"), mime, base64.b64decode(encoded)
    except (ValueError, binascii.Error):
        return None, None, None