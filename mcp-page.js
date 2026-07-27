import "./styles.css";

const app = document.querySelector("#app");
const endpoint = new URL("/api/mcp", window.location.origin).href;

document.title = "Club Meeting Ops MCP · 会议读取与海报";
document.querySelector('meta[name="description"]')?.setAttribute(
  "content",
  "连接 ChatGPT Work、WorkBuddy、Claude Code、飞书 Aily、Kimi Code 或 OpenClaw，读取 Agenda、生成微信群接龙、检查空缺并更新 Future Poster。",
);

app.innerHTML = `
  <main class="mcp-landing">
    <nav class="mcp-nav" aria-label="MCP 页面导航">
      <a class="mcp-brand" href="/"><span>A</span><strong>Agenda Maker</strong></a>
      <a class="mcp-back" href="/">返回 Agenda <span aria-hidden="true">→</span></a>
    </nav>

    <section class="mcp-hero">
      <div class="mcp-hero-copy">
        <span class="eyebrow">Club Meeting Ops · Remote MCP</span>
        <h1>让 Agent 接手<br><span class="mcp-hero-line">会议信息</span><span class="mcp-hero-line">与海报。</span></h1>
        <p>直接问会议、生成接龙、检查空缺。需要时再上传 Future Poster。</p>
        <div class="mcp-capabilities" aria-label="MCP 主要能力">
          <article><span>READ</span><strong>读懂 Agenda</strong><p>查询会议、角色空缺、准备状态与分享链接。</p></article>
          <article><span>TEXT</span><strong>生成群接龙</strong><p>按 Agenda 顺序生成；空缺 emoji 与数量可自定义。</p></article>
          <article><span>UPLOAD</span><strong>上传活动海报</strong><p>更新 Future Poster，并返回 Presentation 页面。</p></article>
        </div>
        <div class="mcp-actions">
          <a class="button primary" href="#connect">开始配置</a>
          <button class="button" type="button" data-copy-endpoint>复制 MCP 地址</button>
        </div>
      </div>
      <aside class="mcp-endpoint-card" aria-label="MCP 服务地址">
        <span>STREAMABLE HTTP</span>
        <strong>Production endpoint</strong>
        <code>${endpoint}</code>
        <dl>
          <div><dt>Authentication</dt><dd>OAuth / Personal Token</dd></div>
          <div><dt>Tools</dt><dd>8 read-only · 1 upload</dd></div>
          <div><dt>Poster formats</dt><dd>PNG / JPEG · 4 MiB</dd></div>
          <div><dt>Upload window</dt><dd>5 minutes</dd></div>
        </dl>
      </aside>
    </section>

    <section class="mcp-usage" aria-labelledby="mcp-usage-title">
      <header><span class="eyebrow">直接这样说</span><h2 id="mcp-usage-title">不需要记 Tool 名。</h2><p>连接后用自然语言提问。Agent 自动选择只读 Tool。</p></header>
      <div class="mcp-example-grid">
        <article><span>01 · FIND</span><strong>找会议、看概况</strong><code>“最近三场会议是什么？”</code><code>“给我 105 期概况。”</code></article>
        <article><span>02 · SIGNUP</span><strong>生成接龙、补招</strong><code>“根据 105 期 Agenda 生成接龙，空缺用 🙋🙋🙋。”</code><code>“只生成还缺人的招募消息。”</code></article>
        <article><span>03 · CHECK</span><strong>会前检查、拿链接</strong><code>“检查 105 期是否可以 Finalize。”</code><code>“给我 Presentation 和 Awards 链接。”</code></article>
      </div>
      <p class="mcp-readonly-note"><span aria-hidden="true">●</span><strong>默认只读：</strong>查询、接龙、空缺、检查、链接不会修改 Agenda。只有海报上传 Tool 会写入。</p>
    </section>

    <section class="mcp-connect" id="connect">
      <header><span class="eyebrow">Connect once</span><h2>选择最快的配置方式。</h2></header>
      <div class="mcp-agent-prompt">
        <div><span class="eyebrow">最快</span><h3>让 AI 帮你配置</h3><p>复制提示词给当前 Agent；需要 Token 时再输入。</p></div>
        <button type="button" data-copy-prompt>复制安装提示词</button>
      </div>

      <div class="mcp-token-panel">
        <label for="mcp-token">个人 Token</label>
        <div class="mcp-token-row">
          <input id="mcp-token" type="password" autocomplete="off" spellcheck="false" placeholder="vpe_…">
          <button type="button" data-generate-token>申请试用 Token</button>
          <button type="button" data-test-token>测试连接</button>
        </div>
        <p class="mcp-token-status" role="status" aria-live="polite">未测试</p>
      </div>

      <div class="mcp-client-tabs">
        <div class="mcp-tab-list" role="tablist" aria-label="选择客户端">
          <button type="button" role="tab" id="tab-chatgpt" aria-controls="panel-chatgpt" aria-selected="true" data-client-tab="chatgpt">ChatGPT Work</button>
          <button type="button" role="tab" id="tab-workbuddy" aria-controls="panel-workbuddy" aria-selected="false" data-client-tab="workbuddy" tabindex="-1">WorkBuddy</button>
          <button type="button" role="tab" id="tab-claude" aria-controls="panel-claude" aria-selected="false" data-client-tab="claude" tabindex="-1">Claude Code</button>
          <button type="button" role="tab" id="tab-feishu" aria-controls="panel-feishu" aria-selected="false" data-client-tab="feishu" tabindex="-1">飞书 Aily</button>
          <button type="button" role="tab" id="tab-kimi" aria-controls="panel-kimi" aria-selected="false" data-client-tab="kimi" tabindex="-1">Kimi Code</button>
          <button type="button" role="tab" id="tab-openclaw" aria-controls="panel-openclaw" aria-selected="false" data-client-tab="openclaw" tabindex="-1">OpenClaw</button>
        </div>
        <article class="mcp-client-panel" role="tabpanel" id="panel-chatgpt" aria-labelledby="tab-chatgpt" data-client-panel="chatgpt">
          <span class="mcp-client-label">CHATGPT WORK</span>
          <h3>OAuth 连接</h3>
          <pre><code data-config="chatgpt"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="chatgpt">复制步骤</button>
          <p>创建 App 时选择 OAuth；浏览器授权页再粘贴个人 Token。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-workbuddy" aria-labelledby="tab-workbuddy" data-client-panel="workbuddy" hidden>
          <span class="mcp-client-label">WORKBUDDY</span>
          <h3>远程 HTTP 配置</h3>
          <pre><code data-config="workbuddy"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="workbuddy">复制配置</button>
          <p>打开“插件 → MCP 服务器 → 配置 MCP”，写入用户级 <code>~/.workbuddy/mcp.json</code>。保存后确认绿色连接状态。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-claude" aria-labelledby="tab-claude" data-client-panel="claude" hidden>
          <span class="mcp-client-label">CLAUDE CODE</span>
          <h3>一条命令</h3>
          <pre><code data-config="claude"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="claude">复制命令</button>
          <p>运行后用 <code>/mcp</code> 检查连接。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-feishu" aria-labelledby="tab-feishu" data-client-panel="feishu" hidden>
          <span class="mcp-client-label">飞书 AILY</span>
          <h3>自定义 MCP</h3>
          <pre><code data-config="feishu"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="feishu">复制配置</button>
          <p>请求头类型选择用户输入。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-kimi" aria-labelledby="tab-kimi" data-client-panel="kimi" hidden>
          <span class="mcp-client-label">KIMI CODE</span>
          <h3>一条命令</h3>
          <pre><code data-config="kimi"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="kimi">复制配置</button>
          <p>运行后用 <code>kimi mcp list</code> 或 <code>/mcp</code> 检查连接。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-openclaw" aria-labelledby="tab-openclaw" data-client-panel="openclaw" hidden>
          <span class="mcp-client-label">OPENCLAW</span>
          <h3>一键复制配置</h3>
          <pre><code data-config="openclaw"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="openclaw">复制 OpenClaw 命令</button>
          <p>运行后会保存配置，并立即检查是否能读取 9 个 Tools。</p>
        </article>
      </div>
    </section>

    <section class="mcp-safety">
      <span aria-hidden="true">●</span>
      <div><strong>默认安全边界</strong><p>个人 Token、Base 启停、OAuth PKCE、版本冲突保护、短时签名地址、图片格式与大小校验。</p></div>
      <a href="/">进入 Agenda →</a>
    </section>

    <dialog class="mcp-token-dialog" data-token-request-dialog>
      <form data-token-request-form>
        <span class="eyebrow">Trial request</span>
        <h2>输入用户名</h2>
        <p>俱乐部 VPE 将通过该名称识别并启用你的 Token。</p>
        <label for="mcp-trial-name">用户名</label>
        <input id="mcp-trial-name" name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="例如 Alex Chen">
        <div class="mcp-dialog-actions">
          <button class="button" type="button" data-close-token-request>取消</button>
          <button class="button primary" type="submit">确认</button>
        </div>
      </form>
    </dialog>

    <dialog class="mcp-token-dialog" data-token-confirm-dialog>
      <form data-token-confirm-form>
        <span class="eyebrow">Confirm trial</span>
        <h2>是否就用这个版本试用？</h2>
        <dl>
          <div><dt>用户名</dt><dd data-trial-name></dd></div>
          <div><dt>Token</dt><dd data-trial-token></dd></div>
          <div><dt>初始状态</dt><dd>未启用</dd></div>
        </dl>
        <p>确认后写入俱乐部飞书 Base。请通知 VPE 勾选 Enabled；启用前无法调用。</p>
        <p class="mcp-dialog-status" role="alert" data-trial-status></p>
        <div class="mcp-dialog-actions">
          <button class="button" type="button" data-back-token-request>返回修改</button>
          <button class="button primary" type="submit">确认并提交</button>
        </div>
      </form>
    </dialog>
  </main>`;

const tokenInput = document.querySelector("#mcp-token");
const status = document.querySelector(".mcp-token-status");

function token() {
  return tokenInput.value.trim();
}

function generatedToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `vpe_${encoded}`;
}

function configs() {
  const value = token() || "<你的个人Token>";
  return {
    chatgpt: `1. ChatGPT Settings → Apps → Create\n2. Server URL: ${endpoint}\n3. Authentication: OAuth\n4. Scan Tools → Create\n5. 授权页输入个人 Token`,
    workbuddy: `{
  "mcpServers": {
    "club-meeting-ops": {
      "type": "http",
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer ${value}"
      }
    }
  }
}`,
    claude: `claude mcp add --scope user --transport http \\\n  club-meeting-ops ${endpoint} \\\n  --header "Authorization: Bearer ${value}"`,
    feishu: `请求地址  ${endpoint}\n请求头    Authorization\n类型      用户输入\n值        Bearer ${value}`,
    kimi: `kimi mcp add --transport http club-meeting-ops \\\n  ${endpoint} \\\n  --header "Authorization: Bearer ${value}"`,
    openclaw: `openclaw mcp set club-meeting-ops '${JSON.stringify({
      url: endpoint,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${value}` },
    })}'\nopenclaw mcp doctor club-meeting-ops --probe`,
  };
}

function renderConfigs() {
  const values = configs();
  document.querySelectorAll("[data-config]").forEach((node) => {
    node.textContent = values[node.dataset.config];
  });
}

function activateClient(name, shouldFocus = false) {
  document.querySelectorAll("[data-client-tab]").forEach((tab) => {
    const active = tab.dataset.clientTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && shouldFocus) tab.focus();
  });
  document.querySelectorAll("[data-client-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.clientPanel !== name;
  });
}

async function copy(text, button) {
  await navigator.clipboard.writeText(text);
  const previous = button.textContent;
  button.textContent = "已复制";
  setTimeout(() => { button.textContent = previous; }, 1200);
}

const requestDialog = document.querySelector("[data-token-request-dialog]");
const confirmDialog = document.querySelector("[data-token-confirm-dialog]");
const nameInput = document.querySelector("#mcp-trial-name");
let trialName = "";

document.querySelector("[data-generate-token]").addEventListener("click", () => {
  requestDialog.showModal();
  nameInput.focus();
});

document.querySelector("[data-close-token-request]").addEventListener("click", () => requestDialog.close());
nameInput.addEventListener("input", () => nameInput.setCustomValidity(""));
document.querySelector("[data-token-request-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  trialName = nameInput.value.trim().replace(/\s+/g, " ");
  if (trialName.length < 2) {
    nameInput.setCustomValidity("请输入至少 2 个字符。");
    nameInput.reportValidity();
    return;
  }
  nameInput.setCustomValidity("");
  tokenInput.value = generatedToken();
  tokenInput.type = "text";
  status.textContent = "尚未提交试用申请。";
  status.className = "mcp-token-status";
  renderConfigs();
  document.querySelector("[data-trial-name]").textContent = trialName;
  document.querySelector("[data-trial-token]").textContent = token();
  document.querySelector("[data-trial-status]").textContent = "";
  requestDialog.close();
  confirmDialog.showModal();
});

confirmDialog.addEventListener("cancel", (event) => event.preventDefault());
document.querySelector("[data-back-token-request]").addEventListener("click", () => {
  confirmDialog.close();
  requestDialog.showModal();
  nameInput.focus();
});

document.querySelector("[data-token-confirm-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const dialogStatus = document.querySelector("[data-trial-status]");
  button.disabled = true;
  dialogStatus.textContent = "提交中…";
  try {
    const response = await fetch(`${endpoint}?trial=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trialName, token: token() }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "提交失败");
    confirmDialog.close();
    status.textContent = "申请已提交，默认未启用。请通知俱乐部 VPE 勾选 Enabled 后再测试连接。";
    status.className = "mcp-token-status ok";
    tokenInput.focus();
    tokenInput.select();
  } catch (error) {
    dialogStatus.textContent = `${error.message}，请稍后重试。`;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("[data-test-token]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!/^vpe_[A-Za-z0-9_-]{43}$/.test(token())) {
    status.textContent = "Token 格式无效。";
    status.className = "mcp-token-status error";
    return;
  }
  button.disabled = true;
  status.textContent = "连接中…";
  status.className = "mcp-token-status";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "club-meeting-ops-setup", version: "1" } },
      }),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error();
    status.textContent = "连接成功：Club Meeting Ops MCP ready，9 个 Tools（8 个只读）。";
    status.className = "mcp-token-status ok";
  } catch {
    status.textContent = "连接失败：确认 Token 已写入 Base 且 Enabled 已勾选。";
    status.className = "mcp-token-status error";
  } finally {
    button.disabled = false;
  }
});

tokenInput.addEventListener("input", renderConfigs);
document.querySelector("[data-copy-endpoint]").addEventListener("click", (event) => copy(endpoint, event.currentTarget));
document.querySelectorAll("[data-copy-config]").forEach((button) => {
  button.addEventListener("click", () => copy(configs()[button.dataset.copyConfig], button));
});
const clientTabs = [...document.querySelectorAll("[data-client-tab]")];
clientTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateClient(tab.dataset.clientTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = clientTabs[(index + offset + clientTabs.length) % clientTabs.length];
    activateClient(next.dataset.clientTab, true);
  });
});
document.querySelector("[data-copy-prompt]").addEventListener("click", (event) => copy(
  `请帮我配置 Club Meeting Ops MCP。\nMCP endpoint: ${endpoint}\nTransport: Streamable HTTP\n认证：ChatGPT Work 使用 OAuth；WorkBuddy 等其他客户端使用 Authorization: Bearer <我的个人Token>。WorkBuddy 用户级配置写入 ~/.workbuddy/mcp.json。\n配置后调用 initialize 和 tools/list，确认共 9 个 Tools，并包含 list_meetings、generate_signup_text、check_meeting_readiness、get_future_posters。不要把 Token 写入 Git、URL 或回答正文。`,
  event.currentTarget,
));

renderConfigs();
