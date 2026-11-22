"""Capture and inspect the local page through Edge's DevTools protocol."""
import base64
import json
import sys
import time

import requests
import websocket


def page_target():
    targets = requests.get("http://127.0.0.1:9222/json/list", timeout=5).json()
    pages = [t for t in targets if t.get("type") == "page" and t.get("url") in ("about:blank", "http://127.0.0.1:4173/")]
    if not pages:
        pages = [t for t in targets if t.get("type") == "page"]
    return pages[0]


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=12)
        self.next_id = 1

    def call(self, method, **params):
        msg_id = self.next_id
        self.next_id += 1
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            raw = self.ws.recv()
            message = json.loads(raw)
            if message.get("id") == msg_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            # Ignore events while waiting for the command result.

    def evaluate(self, expression, await_promise=False):
        result = self.call(
            "Runtime.evaluate",
            expression=expression,
            returnByValue=True,
            awaitPromise=await_promise,
        )
        return result.get("result", {}).get("value")

    def screenshot(self, path, full=False):
        params = {"format": "png", "fromSurface": True}
        if full:
            metrics = self.call("Page.getLayoutMetrics")
            size = metrics.get("contentSize") or metrics.get("cssContentSize")
            params["captureBeyondViewport"] = True
            params["clip"] = {
                "x": 0,
                "y": 0,
                "width": size["width"],
                "height": size["height"],
                "scale": 1,
            }
        data = self.call("Page.captureScreenshot", **params)["data"]
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(data))


def main():
    target = page_target()
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    cdp.call("Log.enable")
    cdp.call(
        "Page.addScriptToEvaluateOnNewDocument",
        source="""
            window.__captureErrors = [];
            addEventListener('error', (event) => window.__captureErrors.push(String(event.message || event.error)));
            addEventListener('unhandledrejection', (event) => window.__captureErrors.push(String(event.reason)));
        """,
    )
    cdp.call("Emulation.setDeviceMetricsOverride", width=1440, height=1100, deviceScaleFactor=1, mobile=False)
    cdp.call("Page.navigate", url="http://127.0.0.1:4173/")
    time.sleep(2.6)

    print("title:", cdp.evaluate("document.title"))
    print("result:", cdp.evaluate("document.querySelector('#resultTime')?.textContent"))
    print("rows:", cdp.evaluate("document.querySelectorAll('#segmentTableBody tr').length"))
    print("chart:", cdp.evaluate("document.querySelector('#speedChart')?.innerHTML.length"))
    print("report:", cdp.evaluate("document.querySelector('#reportText')?.textContent.slice(0,120)"))
    print("console errors:", cdp.evaluate("window.__captureErrors || []"))

    cdp.screenshot("preview-full.png", full=True)
    cdp.evaluate("document.documentElement.style.scrollBehavior = 'auto'")
    for anchor in ("situation", "model", "estimate", "check", "report"):
        cdp.evaluate(
            f"window.scrollTo(0, document.querySelector('#{anchor}').getBoundingClientRect().top + window.scrollY - 80)"
        )
        time.sleep(0.5)
        cdp.screenshot(f"preview-{anchor}.png")

    # Reveal the historical record and capture the comparison.
    cdp.evaluate("document.querySelector('#revealBtn').click()")
    time.sleep(0.8)
    print("cmp:", cdp.evaluate("document.querySelector('#cmpError')?.textContent"))
    cdp.evaluate(
        "window.scrollTo(0, document.querySelector('#check').getBoundingClientRect().top + window.scrollY - 80)"
    )
    time.sleep(0.5)
    cdp.screenshot("preview-check-revealed.png")

    # Mobile layout.
    cdp.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)
    cdp.call("Page.navigate", url="http://127.0.0.1:4173/?mobile=1")
    time.sleep(2.4)
    cdp.evaluate("document.documentElement.style.scrollBehavior = 'auto'")
    cdp.evaluate("window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;")
    time.sleep(0.8)
    print("mobile scrollY:", cdp.evaluate("window.scrollY"))
    cdp.screenshot("preview-mobile-hero.png")
    for anchor in ("model", "estimate", "check"):
        cdp.evaluate(
            f"window.scrollTo(0, document.querySelector('#{anchor}').getBoundingClientRect().top + window.scrollY - 70)"
        )
        time.sleep(0.45)
        cdp.screenshot(f"preview-mobile-{anchor}.png")

    print("done")


if __name__ == "__main__":
    main()
