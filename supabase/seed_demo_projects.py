"""
Give the demo account its two sample projects.

Idempotent: if the demo user already has projects, nothing happens.
The demo sign-in (POST /api/auth/demo) creates the account on first use;
this gives it content so ?demo=1 shows a populated dashboard.

    .venv\\Scripts\\python.exe supabase\\seed_demo_projects.py
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import db

DEMO_EMAIL = "demo@sitesketch.app"


def demo_user():
    return db.query_one("select id, username from users where lower(email) = %s", (DEMO_EMAIL,))


def project(name, kind, goal, slug, published, views, days_ago, pages):
    return {
        "name": name,
        "type_id": kind,
        "goal_id": goal,
        "slug": slug,
        "is_published": published,
        "view_count": views,
        "days_ago": days_ago,
        "plan_json": {
            "meta": {"type": kind, "goal": goal, "theme": "modern", "siteName": name},
            "pages": pages,
        },
    }


def section(kind, title, subtitle, fields=None):
    return {"type": kind, "title": title, "subtitle": subtitle, "fields": fields or {}}


def main() -> int:
    user = demo_user()
    if not user:
        print("No demo account yet. Open ?demo=1 once, then run this again.")
        return 1

    existing = db.query("select id from projects where user_id = %s::uuid", (str(user["id"]),))
    if existing:
        print(f"Demo account already has {len(existing)} project(s); nothing to do.")
        return 0

    lolas = project(
        "Lola's Kitchen", "restaurant", "show-menu", "lolas-kitchen", False, 0, 3,
        [
            {"id": "home", "name": "Home", "sections": [
                section("hero", "Home-cooked Filipino comfort food", "Family recipes since 1987", {"buttonText": "See the menu"}),
                section("menu", "Menu highlights", "Customer favorites"),
                section("hours", "Hours & location", "Open Tuesday to Sunday"),
            ]},
            {"id": "about", "name": "About", "sections": [
                section("about", "Our story", "Three generations of home cooking"),
                section("contact", "Get in touch", "Reserve a table"),
            ]},
        ],
    )

    portfolio = project(
        "My Portfolio", "portfolio", "get-hired", "my-portfolio", True, 0, 10,
        [
            {"id": "home", "name": "Home", "sections": [
                section("hero", "Design student & web enthusiast", "Open to internships and collabs", {"buttonText": "View my work"}),
                section("gallery", "Selected work", "School and personal projects"),
                section("contact", "Get in touch", "Open to internships"),
            ]},
        ],
    )

    for p in (lolas, portfolio):
        db.query_one(
            "insert into projects (user_id, type_id, goal_id, name, plan_json, theme, slug,"
            " is_published, view_count, created_at, updated_at)"
            " values (%s::uuid, %s, %s, %s, %s::jsonb, 'modern', %s, %s, %s,"
            " now() - (%s || ' days')::interval, now() - (%s || ' hours')::interval)"
            " returning id",
            (str(user["id"]), p["type_id"], p["goal_id"], p["name"],
             json.dumps(p["plan_json"]), p["slug"], p["is_published"], p["view_count"],
             str(p["days_ago"]), str(p["days_ago"] * 12)),
        )
        print(f"  added {p['name']}")

    print("demo account seeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())