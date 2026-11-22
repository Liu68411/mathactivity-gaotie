"""Interactive smoke test through Edge's DevTools protocol."""
import json
import sys
import time

import requests
import websocket

sys.stdout.reconfigure(encoding="utf-8")


def page_target():
    targets = requests.get("http://127.0.0.1:9222/json/list", timeout=5).json()
    return [t for t in targets if t.get("type") == "page"][0]


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=12)
        self.next_id = 1

    def call(self, method, **params):
        msg_id = self.next_id
        self.next_id += 1
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == msg_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def ev(self, expression):
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        return result.get("result", {}).get("value")


def check(condition, label):
    print(("PASS " if condition else "FAIL ") + label)
    if not condition:
        raise SystemExit(1)


def main():
    cdp = CDP(page_target()["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    cdp.call(
        "Page.addScriptToEvaluateOnNewDocument",
        source="""
            window.__uiErrors = [];
            addEventListener('error', (event) => window.__uiErrors.push(String(event.message || event.error)));
            addEventListener('unhandledrejection', (event) => window.__uiErrors.push(String(event.reason)));
        """,
    )
    cdp.call("Emulation.setDeviceMetricsOverride", width=1440, height=1100, deviceScaleFactor=1, mobile=False)
    cdp.call("Page.navigate", url="http://127.0.0.1:4173/?ui-test=1")
    time.sleep(2.5)

    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:04", "default arrival 16:04")
    check(cdp.ev("document.querySelector('#resultDelay').textContent").endswith("38 分钟"), "default delay 38")
    check(cdp.ev("document.querySelectorAll('#segmentTableBody tr').length") == 3, "simple model rows")

    cdp.ev(
        "(() => { const el=document.querySelector('#preSlow'); el.value=50; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    )
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:11", "preSlow 50 -> 16:11")

    cdp.ev(
        "(() => { const el=document.querySelector('#preSlow'); el.value=60; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    )
    time.sleep(0.2)
    cdp.ev("document.querySelector('[data-preset=withStops]').click()")
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:09", "with stops -> 16:09")
    check(cdp.ev("document.querySelector('#resultDelay').textContent").endswith("43 分钟"), "with stops delay 43")
    check(cdp.ev("document.querySelectorAll('#segmentTableBody tr').length") == 6, "with stops rows")
    check(cdp.ev("document.querySelector('[data-preset=withStops]').classList.contains('is-active')"), "preset active")

    cdp.ev("document.querySelector('#revealBtn').click()")
    time.sleep(0.5)
    check(cdp.ev("document.querySelector('#actualPanel').hidden === false"), "actual panel revealed")
    check(cdp.ev("document.querySelector('#cmpError').textContent").strip() == "早 4 分钟", "error 4 min early")
    check(cdp.ev("document.querySelector('#solveBtn').textContent").strip().endswith("171"), "solve button 171")

    cdp.ev("document.querySelector('#solveBtn').click()")
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#v2').value") == "171", "v2 set to 171")
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:13", "fixed arrival 16:13")
    check(cdp.ev("document.querySelector('#cmpError').textContent").strip() == "刚好", "fixed error zero")

    cdp.ev("document.querySelector('#resealBtn').click()")
    time.sleep(0.3)
    check(cdp.ev("document.querySelector('#actualPanel').hidden === true"), "actual panel resealed")
    check(cdp.ev("document.querySelector('#legendActual').hidden === true"), "legend actual hidden")

    cdp.ev("document.querySelector('#resetBtn').click()")
    time.sleep(0.3)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:04", "reset arrival")
    check(cdp.ev("document.querySelector('#v2').value") == "180", "reset v2")

    errors = cdp.ev("window.__uiErrors || []")
    check(not errors, f"no runtime errors: {errors}")
    print("UI smoke tests passed")


if __name__ == "__main__":
    main()
