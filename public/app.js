(() => {
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  let cfg = { siteName: "Open Ear", hostName: "Your Host", categories: [], limits: {}, isHost: false };
  let filter = "";

  // ---------- small helpers (all text goes through textContent, never innerHTML) ----------
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  async function api(path, opts = {}) {
    const r = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function toast(msg) {
    const t = h("div", { class: "toast", role: "status" }, msg);
    document.body.append(t); setTimeout(() => t.remove(), 2600);
  }
  function ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    const hr = Math.floor(m / 60); if (hr < 24) return hr + (hr === 1 ? " hour ago" : " hours ago");
    const d = Math.floor(hr / 24); if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const tokens = {
    get: (id) => { try { return localStorage.getItem("tok:" + id); } catch { return null; } },
    set: (id, t) => { try { localStorage.setItem("tok:" + id, t); } catch {} },
  };

  // ---------- views ----------
  async function home() {
    document.title = cfg.siteName;
    app.replaceChildren(
      h("section", { class: "hero" },
        h("h1", {}, "Say what you are carrying."),
        h("p", {}, "Post anonymously about whatever you are dealing with. " + cfg.hostName + " reads every post and replies with honest, thoughtful advice. Free, always."),
        h("a", { class: "btn", href: "#new" }, "Share something")),
      h("div", { class: "chips", id: "chips" }),
      h("div", { id: "list" }, h("p", { class: "empty" }, "Loading...")));
    const chips = $("#chips");
    for (const c of ["", ...cfg.categories]) {
      chips.append(h("button", { class: "chip" + (filter === c ? " on" : ""), onclick: () => { filter = c; home(); } }, c || "All"));
    }
    try {
      const { posts } = await api("/posts" + (filter ? "?category=" + encodeURIComponent(filter) : ""));
      const list = $("#list");
      if (!posts.length) return list.replaceChildren(h("p", { class: "empty" }, "Nothing here yet. Be the first to share."));
      list.replaceChildren(...posts.map((p) =>
        h("a", { class: "card", href: "#p-" + p.id },
          h("h3", {}, p.title),
          h("p", { class: "excerpt" }, p.body),
          h("div", { class: "meta" },
            h("span", { class: "tag" }, p.category),
            p.answered ? h("span", { class: "tag ok" }, "Answered") : h("span", {}, "Awaiting advice"),
            h("span", {}, p.replyCount + (p.replyCount === 1 ? " reply" : " replies")),
            h("span", {}, ago(p.createdAt))))));
    } catch (e) { $("#list").replaceChildren(h("p", { class: "empty" }, e.message)); }
  }

  function newPost() {
    document.title = "Share something | " + cfg.siteName;
    const title = h("input", { type: "text", maxlength: cfg.limits.title, placeholder: "A short summary", required: true });
    const body = h("textarea", { maxlength: cfg.limits.body, placeholder: "Tell the story as you see it. Leave out names and details that could identify you or others.", required: true });
    const cat = h("select", {}, cfg.categories.map((c) => h("option", { value: c }, c)));
    const count = h("span", {}, "0 / " + cfg.limits.body);
    body.addEventListener("input", () => (count.textContent = body.value.length + " / " + cfg.limits.body));
    const err = h("p", { class: "err" });
    const btn = h("button", { class: "btn" }, "Post anonymously");
    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; err.textContent = "";
        try {
          const { post, token } = await api("/posts", { method: "POST", body: { title: title.value, body: body.value, category: cat.value } });
          tokens.set(post.id, token);
          location.hash = "p-" + post.id;
          toast("Posted. Bookmark this page to come back for your reply.");
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      },
    },
      h("label", {}, "Title"), title,
      h("label", {}, "Topic"), cat,
      h("label", {}, "What is going on?"), body, h("div", { class: "hint" }, h("span", {}, "Be as open as you like."), count),
      h("div", { class: "note" }, "Nothing links this post to you. To see replies, bookmark the page you land on after posting. If you clear your browser data, keep the link so you can find it again."),
      err, h("div", { class: "row" }, h("a", { class: "btn ghost", href: "#" }, "Cancel"), btn));
    app.replaceChildren(h("a", { class: "back", href: "#" }, "< Back"), h("h2", {}, "Share something"), form);
  }

  async function postView(pid) {
    app.replaceChildren(h("p", { class: "empty" }, "Loading..."));
    let data;
    try { data = await api("/posts/" + pid); }
    catch (e) { return app.replaceChildren(h("a", { class: "back", href: "#" }, "< Back"), h("p", { class: "empty" }, e.message)); }
    const { post, replies } = data;
    document.title = post.title + " | " + cfg.siteName;
    const myToken = tokens.get(pid);

    const replyEls = replies.length
      ? replies.map((r) => h("div", { class: "reply " + r.kind },
          h("div", { class: "who" }, r.kind === "host" ? cfg.hostName : "Original poster", h("span", { style: "font-weight:400" }, ago(r.createdAt)),
            cfg.isHost ? h("button", { class: "link", onclick: async () => { if (!confirm("Delete this reply?")) return; await api("/replies/" + r.id, { method: "DELETE" }); postView(pid); } }, "delete") : null),
          h("div", { class: "txt" }, r.body)))
      : [h("p", { class: "empty", style: "padding:20px 0" }, "No reply yet. " + cfg.hostName + " will respond as soon as possible. Bookmark this page and check back.")];

    // reply box: host writes advice, original poster writes follow-ups
    let box = null;
    if (cfg.isHost || myToken) {
      const ta = h("textarea", { maxlength: cfg.isHost ? cfg.limits.reply : cfg.limits.followup, placeholder: cfg.isHost ? "Write your advice..." : "Add a follow-up..." });
      const err = h("p", { class: "err" });
      const btn = h("button", { class: "btn" }, cfg.isHost ? "Publish reply" : "Add follow-up");
      btn.addEventListener("click", async () => {
        btn.disabled = true; err.textContent = "";
        try { await api("/posts/" + pid + "/replies", { method: "POST", body: { body: ta.value, token: myToken } }); postView(pid); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      });
      box = h("div", { class: "card" }, h("label", { style: "margin-top:0" }, cfg.isHost ? "Reply as " + cfg.hostName : "Reply as the original poster"), ta, err, h("div", { class: "row" }, btn));
    }

    const del = cfg.isHost ? h("button", { class: "btn danger small", onclick: async () => { if (!confirm("Delete this whole post?")) return; await api("/posts/" + pid, { method: "DELETE" }); location.hash = ""; } }, "Delete post") : null;
    app.replaceChildren(
      h("a", { class: "back", href: "#" }, "< All posts"),
      h("article", { class: "card" },
        h("div", { class: "meta", style: "margin-bottom:10px" }, h("span", { class: "tag" }, post.category), h("span", {}, ago(post.createdAt)), del),
        h("h2", { style: "margin:0 0 12px" }, post.title),
        h("div", { class: "post-body" }, post.body)),
      h("section", { class: "thread" }, h("h3", {}, "Advice"), ...replyEls, box));
  }

  // ---------- host sign in ----------
  const dlg = $("#loginDlg");
  function refreshAuth() {
    const b = $("#navAuth");
    b.hidden = false;
    b.textContent = cfg.isHost ? "Sign out" : "Host";
    b.onclick = async () => {
      if (cfg.isHost) { await api("/logout", { method: "POST" }); cfg.isHost = false; refreshAuth(); route(); }
      else { $("#loginErr").textContent = ""; dlg.showModal(); $("#pw").focus(); }
    };
  }
  $("#loginCancel").onclick = () => dlg.close();
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/login", { method: "POST", body: { password: $("#pw").value } }); $("#pw").value = ""; cfg.isHost = true; dlg.close(); refreshAuth(); route(); toast("Signed in"); }
    catch (ex) { $("#loginErr").textContent = ex.message; }
  });

  // ---------- routing ----------
  function route() {
    const hash = location.hash.slice(1);
    window.scrollTo(0, 0);
    if (hash === "new") return newPost();
    const m = /^p-([a-f0-9]+)$/.exec(hash);
    if (m) return postView(m[1]);
    return home();
  }
  window.addEventListener("hashchange", route);

  (async () => {
    try { cfg = await api("/config"); } catch {}
    $(".brand").textContent = cfg.siteName;
    refreshAuth();
    route();
  })();
})();
