"""What the site can send to somebody else, and for how long we keep things.

The privacy policy on /privacy renders from these tables rather than being
written out by hand, so the published policy cannot quietly disagree with
what the code does. A third party added without a line here is a third party
the policy does not mention, which is exactly the drift this exists to stop.

Note what is *not* here: no analytics, no advertising, no tag manager, no
chat widget, no session recording, no A/B testing. Nothing on this site
profiles visitors, and adding one means adding it here first.
"""

from __future__ import annotations

from flask import Blueprint, jsonify

from cookies import COOKIE_INVENTORY, COOKIES_IN_USE

bp = Blueprint("privacy", __name__, url_prefix="/api/privacy")


# Each of these receives the visitor's IP address simply by being asked for
# something. That is a disclosure under GDPR even though no identifier is
# attached to it, so they are listed with what they are actually used for.
THIRD_PARTIES: list[dict] = [
    {
        "name": "Supabase",
        "where": "Database and file storage",
        "why": "Accounts, plans and uploaded images are stored here.",
        "what_leaves": "Your IP address, plus whatever you typed in.",
        "optional": False,
    },
    {
        "name": "Google Fonts",
        "where": "fonts.googleapis.com, fonts.gstatic.com",
        "why": "Serves the typefaces the generated sites are designed with.",
        "what_leaves": "Your IP address and the page you are on.",
        "optional": False,
        "note": (
            "Self-hosting the fonts would remove this. It is the one third-party "
            "request a visitor cannot opt out of without the site losing its typefaces."
        ),
    },
    {
        "name": "Unsplash",
        "where": "images.unsplash.com",
        "why": "Serves placeholder photos for sites that have not uploaded their own.",
        "what_leaves": "Your IP address.",
        "optional": True,
        "note": "Only requested when a site actually uses a stock photo. Your own uploads go to Supabase instead.",
    },
    {
        "name": "Vercel",
        "where": "Hosting and CDN",
        "why": "Serves the site and runs the Python backend.",
        "what_leaves": "Your IP address and the request.",
        "optional": False,
    },
    {
        "name": "Google Gemini",
        "where": "Server-side only",
        "why": "Writes the page plan and the design for your site.",
        "what_leaves": (
            "The brief you typed, sent from our server. Never your email, your "
            "password or your account details."
        ),
        "optional": False,
    },
]

# How long each category of data survives. Deleting an account removes the
# rows listed under "deleted with your account" immediately.
RETENTION: list[dict] = [
    {"data": "Email address, username, password hash", "why": "To let you sign in", "kept": "Until you delete your account"},
    {"data": "Password", "why": "Never stored", "kept": "Not stored at all, in any form"},
    {"data": "Projects and plans", "why": "Your work", "kept": "Until you delete them or your account"},
    {"data": "Uploaded images", "why": "To show them on your site", "kept": "Until you delete them or your account"},
    {"data": "Session cookie", "why": "To keep you signed in", "kept": "Until you close the browser, or 30 days if you asked to stay signed in"},
    {"data": "Cookie preferences", "why": "So we stop asking", "kept": "12 months"},
    {"data": "View count on a published site", "why": "A number, shown to the owner", "kept": "Until the site is deleted"},
    {"data": "Server logs", "why": "Investigating faults and abuse", "kept": "Short period set by the host; not used for profiling"},
]


def summary() -> dict:
    return {
        "cookies": COOKIE_INVENTORY,
        "cookies_in_use": sorted(COOKIES_IN_USE),
        "third_parties": THIRD_PARTIES,
        "retention": RETENTION,
        # Stated plainly rather than implied: there is nothing here to consent
        # to, because nothing here tracks anybody.
        "tracking_categories_used": [],
    }


@bp.get("/summary")
def privacy_summary():
    return jsonify(summary())
