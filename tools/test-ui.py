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
    cdp.call("Page.navigate", url="http://127.0.0.1:4173/?ui-test=uniform")
    time.sleep(2.5)

    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:17", "default uniform arrival 16:17")
    check(cdp.ev("document.querySelector('#resultDelay').textContent").endswith("51 分钟"), "default delay 51")
    check(cdp.ev("document.querySelectorAll('#segmentTableBody tr').length") == 6, "six uniform segments")
    check("12.9" in cdp.ev("document.querySelector('#calibrationNote').textContent"), "acceleration note 12.9")
    check("23.3" in cdp.ev("document.querySelector('#calibrationNote').textContent"), "acceleration note 23.3")
    check(cdp.ev("document.querySelector('#distanceChart').innerHTML.length") > 1000, "s-t chart drawn")
    check("斜率" in cdp.ev("document.querySelector('#distanceChartCaption').textContent"), "s-t caption slope")
    check(cdp.ev("document.querySelector('#legendDistanceActual').hidden") is True, "s-t actual legend hidden")
    check(cdp.ev("document.querySelectorAll('.calc-step').length") == 9, "nine calculation steps")
    check("s₁ = ½ × 300" in cdp.ev("document.querySelector('#formulaList').textContent"), "acceleration distance formula")
    check("16:16:31" in cdp.ev("document.querySelector('#formulaList').textContent"), "arrival formula")

    cdp.ev(
        "(() => { const el=document.querySelector('#preSlow'); el.value=50; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    )
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:24", "preSlow 50 -> 16:24")

    cdp.ev(
        "(() => { const el=document.querySelector('#v1'); el.value=350; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    )
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:12", "v1 350 + preSlow 50 -> 16:12")
    check("15.0" in cdp.ev("document.querySelector('#calibrationNote').textContent"), "0->350 takes 15.0 min")

    cdp.ev("document.querySelector('#resetBtn').click()")
    time.sleep(0.3)
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:17", "reset arrival")

    cdp.ev("document.querySelector('#revealBtn').click()")
    time.sleep(0.5)
    check(cdp.ev("document.querySelector('#actualPanel').hidden === false"), "actual panel revealed")
    check(cdp.ev("document.querySelector('#legendDistanceActual').hidden === false"), "s-t actual legend shown")
    check(cdp.ev("document.querySelector('#cmpError').textContent").strip() == "晚 4 分钟", "error 4 min late")
    check("16:17 − 16:13 = 4 分" in cdp.ev("document.querySelector('#formulaList').textContent"), "actual comparison formula")
    check(cdp.ev("document.querySelector('#solveBtn').textContent").strip().endswith("189"), "solve button 189")

    cdp.ev("document.querySelector('#solveBtn').click()")
    time.sleep(0.4)
    check(cdp.ev("document.querySelector('#v2').value") == "189", "v2 set to 189")
    check(cdp.ev("document.querySelector('#resultTime').textContent") == "16:13", "fixed arrival 16:13")
    check(cdp.ev("document.querySelector('#cmpError').textContent").strip() == "刚好", "fixed error zero")

    cdp.ev("document.querySelector('#resealBtn').click()")
    time.sleep(0.3)
    check(cdp.ev("document.querySelector('#actualPanel').hidden === true"), "actual panel resealed")
    check(cdp.ev("document.querySelector('#legendActual').hidden === true"), "v-t legend actual hidden")
    check(cdp.ev("document.querySelector('#legendDistanceActual').hidden === true"), "s-t legend actual hidden again")

    errors = cdp.ev("window.__uiErrors || []")
    check(not errors, f"no runtime errors: {errors}")
    print("UI smoke tests passed")


if __name__ == "__main__":
    main()
