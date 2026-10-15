import { randomBytes } from "node:crypto";

/** One browser-like session: cookie jar + CSRF token. */
export class Actor {
  constructor(label, base, origin) {
    this.label = label;
    this.base = base;
    this.origin = origin ?? base;
    this.jar = new Map();
    this.csrf = null;
    this.id = null;
    this.email = null;
    this.pw = null;
    this.last = null; // { status, json } of the latest call (error bodies included)
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorb(res) {
    const lines = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    for (const line of lines) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      if (i < 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = !value || attrs.some((a) => /max-age=0\b/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  /** `expect`: status or list of statuses; returns raw JSON. */
  async call(step, method, apiPath, { body, expect = 200, headers = {}, ids, recordSink } = {}) {
    const h = { Origin: this.origin, Accept: "application/json", ...headers };
    if (this.jar.size) h.Cookie = this.cookieHeader();
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (method !== "GET" && this.csrf) h["X-CSRF-Token"] = this.csrf;
    const started = performance.now();
    const res = await fetch(`${this.base}/api${apiPath}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.absorb(res);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    this.last = { status: res.status, json };
    const ok = [].concat(expect).includes(res.status);
    const ms = Math.round(performance.now() - started);
    const record = {
      actor: this.label,
      step,
      request: `${method} /api${apiPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}`,
      status: res.status,
      expected: expect,
      ok,
      ms,
      requestId: res.headers.get("x-request-id") ?? undefined,
      errorCode: json?.error?.code ?? undefined,
      ids: ids ? ids(json?.data ?? {}) : undefined,
    };
    if (recordSink) recordSink(record);
    if (!ok) throw new Error(`${this.label}: ${step} -> ${res.status} ${json?.error?.code ?? ""} (expected ${expect})`);
    return json?.data;
  }

  async refreshCsrf(recordSink) {
    const data = await this.call("csrf token", "GET", "/auth/csrf", { recordSink });
    this.csrf = data.csrfToken;
  }

  async register(email, recordSink) {
    const pw = `Rw12!${randomBytes(12).toString("base64url")}`;
    const data = await this.call("register (email)", "POST", "/auth/register", {
      body: { email, password: pw },
      expect: 201,
      ids: (d) => ({ userId: d.user?.id }),
      recordSink,
    });
    this.id = data.user.id;
    this.email = email;
    this.pw = pw;
    await this.refreshCsrf(recordSink);
  }

  async login(recordSink) {
    this.jar.clear();
    this.csrf = null;
    await this.call("login", "POST", "/auth/login", { body: { email: this.email, password: this.pw }, recordSink });
    await this.refreshCsrf(recordSink);
  }
}
