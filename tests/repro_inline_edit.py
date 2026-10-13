"""Reproduce the intermittent inline-edit failure with instrumentation.

Three of 22 journey checks failed in three of four runs, always the same
three: the inline edit did not stick. A hypothesis is not a diagnosis, so
this drives the same sequence as the journey and records what actually
happens: whether blur fired, whether the value reached the plan, whether the
node survived, and whether the canvas re-rendered underneath it.

Run:
    .venv\\Scripts\\python.exe tests\repro_inline_edit.py http://127.0.0.1:3000
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
import uuid

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
PASSWORD = "chicken-karewa1"
TEXT = "Edited by the repro"

# Records, in the page, what happened around the edit.
INSTRUMENT = """
() => {
  window.__log = {renders: 0, blurs: 0, writes: [], nodeReplaced: false};
  const E = window.Editor;
  const origRender = E.render;
  E.render = function () {
    window.__log.renders++;
    return origRender.apply(this, arguments);
  };
  const origWrite = E.writeValue;
  E.writeValue = function (plan, pageId, sectionId, path, value) {
    window.__log.writes.push({path: String(path), value: String(value).slice(0, 60)});
    return origWrite.apply(this, arguments);
  };
  document.addEventListener('blur', function () { window.__log.blurs++; }, true);
  document.addEventListener('focusout', function () { window.__log.blurs++; }, true);
  // remember the node we are about to edit so we can tell if it is replaced
  window.__watched = null;
  const first = document.querySelector('.ss-sec [data-edit]');
  if (first) {
    window.__watched = first;
    window.__watchedPath = first.dataset.edit;
    const obs = new MutationObserver(() => {
      if (!first.isConnected) window.__log.nodeReplaced = true;
    });
    obs.observe(document.body, {childList: true, subtree: true});
  }
  return {watchedPath: window.__watchedPath, text: window.__watched ? window.__watched.innerText.trim().slice(0,50) : null};
}
"""

READ_BACK = """
() => {
  const log = window.__log || {};
  const first = document.querySelector('.ss-sec [data-edit]');
  return {
    renders: log.renders, blurs: log.blurs,
    writes: log.writes, nodeReplaced: !!log.nodeReplaced,
    watchedStillConnected: window.__watched ? window.__watched.isConnected : null,
    firstTextNow: first ? first.innerText.trim().slice(0, 60) : null,
    firstPathNow: first ? first.dataset.edit : null,
    storedFirstValue: window.Editor.plan.pages[0].sections[0].title
  };
}
"""


def api(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def reset_limits():
    try:
        urllib.request.urlopen(
            urllib.request.Request(BASE + "/api/dev/reset-limits", method="POST"), timeout=10)
    except Exception:
        pass


def build_project():
    reset_limits()
    tag = uuid.uuid4().hex[:6]
    reg = api("POST", "/api/auth/register",
              {"username": "repro_" + tag, "email": f"repro_{tag}@example.com",
               "password": PASSWORD})
    token = reg["token"]
    user = reg.get("user") or {}
    proj = api("POST", "/api/projects",
               {"name": "Repro", "type": "business", "goal": "get-contact"}, token)
    plan = {
        "meta": {"type": "business", "goal": "get-contact", "theme": "modern",
                 "siteName": "Repro"},
        "pages": [{"id": "home", "name": "Home", "sections": [
            {"id": "s1", "type": "hero", "title": "Original headline",
             "subtitle": "Original subtitle", "fields": {"buttonText": "Go"}},
            {"id": "s2", "type": "about", "title": "About", "subtitle": "s",
             "fields": {}},
        ]}],
    }
    api("PUT", f"/api/projects/{proj['id']}", {"plan_json": plan}, token)
    return proj["id"], token, user


def main() -> int:
    pid, token, user = build_project()
    print(f"project {pid}\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:120]))

        page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        page.evaluate("(s) => { localStorage.setItem('sitesketch_token_v1', s.t);"
                      " localStorage.setItem('sitesketch_user_v1', JSON.stringify(s.u)); }",
                      {"t": token, "u": user})
        page.goto(f"{BASE}/builder.html?id={pid}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec [data-edit]", timeout=30000)
        page.wait_for_timeout(1200)

        setup = page.evaluate(INSTRUMENT)
        print(f"  watching path={setup['watchedPath']!r} text={setup['text']!r}\n")

        target = page.locator(".ss-sec [data-edit]").first
        target.click()
        page.wait_for_timeout(150)
        target.fill(TEXT)
        page.wait_for_timeout(150)
        page.keyboard.press("Escape")
        page.wait_for_timeout(2000)

        back = page.evaluate(READ_BACK)
        print("  after Escape:")
        for key, value in back.items():
            print(f"    {key}: {value}")
        if errors:
            print("  JS errors:")
            for e in errors[:4]:
                print(f"    {e}")
        ctx.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())