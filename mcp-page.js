import "./styles.css";

const app = document.querySelector("#app");
const endpoint = new URL("/api/mcp", window.location.origin).href;

document.title = "Club Meeting Ops MCP · Agenda 与 Role Booking";
document.querySelector('meta[name="description"]')?.setAttribute(
  "content",
  "远程 MCP：查询和调整 Agenda，代会员预约角色与目标，并生成接龙、检查会前状态或更新 Future Poster。",
);

app.innerHTML = `
  <main class="mcp-landing">
    <nav class="mcp-nav" aria-label="MCP 页面导航">
      <a class="mcp-brand" href="/"><span>A</span><strong>Agenda Maker</strong></a>
      <a class="mcp-back" href="/about"><span aria-hidden="true">←</span> 返回 Club Meeting Ops</a>
    </nav>

    <section class="mcp-hero">
      <div class="mcp-hero-copy">
        <span class="eyebrow">VPE Agenda · Remote MCP · V8</span>
        <h1>一句话调整<br><span class="mcp-hero-line">Agenda。</span><span class="mcp-hero-line">明确就执行。</span></h1>
        <p>Draft 单项修改直接写入；封版、批量与结构性操作先显示日期、期数和摘要，确认一次后执行。每次写入都审计、回读并可安全撤销。</p>
        <div class="mcp-capabilities" aria-label="Agenda 编辑范围">
          <article><span>PEOPLE</span><strong>人员与 Role Book</strong><p>官员可为明确会员预约空缺；取消或转让先确认。</p></article>
          <article><span>TIME</span><strong>重排时间线</strong><p>修改开始时间与时长，自动重算全场时间。</p></article>
          <article><span>STRUCTURE</span><strong>增删环节</strong><p>调整 Session 与议程项，添加公开演示链接。</p></article>
        </div>
        <div class="mcp-actions">
          <a class="button primary" href="#connect">连接 Agenda MCP</a>
          <button class="button" type="button" data-copy-endpoint>复制 MCP 地址</button>
        </div>
      </div>
      <aside class="mcp-edit-card" aria-label="Agenda 对话式编辑示例">
        <div class="mcp-edit-card-header"><span>EDIT · SAFE APPLY</span><strong>MEETING #105</strong></div>
        <div class="mcp-message is-user"><span>YOU</span><p>把 #105 的 Timer 换成 Abby。</p></div>
        <div class="mcp-message is-agent">
          <span>AGENDA MCP</span>
          <p>第 105 期 · 2026-08-11 已写入并回读：</p>
          <dl>
            <div><dt>Timer Intro</dt><dd><s>Alice</s><b>Abby</b></dd></div>
            <div><dt>Timer Report</dt><dd><s>Alice</s><b>Abby</b></dd></div>
          </dl>
        </div>
        <div class="mcp-edit-result"><span aria-hidden="true">✓</span><p><strong>已写入并回读验证</strong><small>Revision 23 → 24</small></p></div>
      </aside>
    </section>

    <section class="mcp-usage" aria-labelledby="mcp-usage-title">
      <header><span class="eyebrow">它也能完成</span><h2 id="mcp-usage-title">连接后，直接说需求。</h2><p>不用记 Tool 名、ID、hash 或 revision。明确目标直接执行；高风险操作确认一次。</p></header>
      <div class="mcp-example-grid">
        <article><span>READ</span><strong>查会议、做会前检查</strong><code>“给我 105 期概况。”</code><code>“检查 105 期是否可以 Finalize。”</code></article>
        <article><span>TEXT</span><strong>生成接龙、补招</strong><code>“按 105 期 Agenda 生成接龙，空缺用 🙋🙋🙋。”</code><code>“只生成还缺人的招募消息。”</code></article>
        <article><span>BOOK & SHARE</span><strong>代预约、拿链接、更新海报</strong><code>“帮 Alice 预约 #108 的 Timer。”</code><code>“给我 Presentation 链接，并更新 Future Poster。”</code></article>
      </div>
      <p class="mcp-readonly-note"><span aria-hidden="true">●</span><strong>仅限获授权的会议管理者：</strong>每次代操作必须明确会员与会议；空缺预约、新建目标可立即执行，其余 Booking 修改必须确认。试用 Token 需俱乐部 VPE 启用。</p>

      <section class="mcp-role-booking-guide" aria-labelledby="mcp-role-booking-title">
        <header>
          <span class="eyebrow">Role Booking · New</span>
          <h3 id="mcp-role-booking-title">新增能力已包含在同一个 MCP。</h3>
          <p>无需创建第二个 Server。Agent 先读取明确会员与会议，再按动作风险决定立即执行或先提案确认。</p>
        </header>
        <div class="mcp-example-grid">
          <article><span>CONTEXT</span><strong>读取目标与目录</strong><code>get_role_booking_context</code><code>search_pathways_projects</code></article>
          <article><span>IMMEDIATE</span><strong>预约空缺、新建目标</strong><code>book_role</code><code>create_booking_goal</code></article>
          <article><span>CONFIRM FIRST</span><strong>取消、转让与资料修改</strong><code>propose_role_booking_change</code><code>apply_role_booking_change</code></article>
        </div>
        <p class="mcp-readonly-note"><span aria-hidden="true">↻</span><strong>已经连接过：</strong>保留原 endpoint 与 Token，重连客户端并重新 Scan Tools，再点击下方“测试连接”；显示 “Agenda + Role Booking MCP ready” 才算升级完成。</p>
        <p class="mcp-readonly-note"><span aria-hidden="true">◆</span><strong>管理员部署：</strong>Production 需启用 <code>MCP_BOOKING_WRITE_ENABLED=true</code>；个人客户端无需配置此变量。</p>
      </section>
    </section>

    <section class="mcp-connect" id="connect">
      <header><span class="eyebrow">Connect once</span><h2>选择最快的配置方式。</h2><p>新连接按客户端完成一次配置；已有连接只需重连并重新扫描 Tools。</p></header>
      <aside class="mcp-endpoint-card mcp-connect-endpoint" aria-label="MCP 服务地址">
        <span>STREAMABLE HTTP</span>
        <strong>Production endpoint</strong>
        <code>${endpoint}</code>
        <dl>
          <div><dt>Authentication</dt><dd>OAuth / Bearer / token header</dd></div>
          <div><dt>Capabilities</dt><dd>Agenda、Role Booking、海报</dd></div>
          <div><dt>Write boundary</dt><dd>官员代理 · 单会员/单会议/单动作</dd></div>
        </dl>
      </aside>
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
          <button type="button" role="tab" id="tab-header-token" aria-controls="panel-header-token" aria-selected="false" data-client-tab="header-token" tabindex="-1">Header Token</button>
          <button type="button" role="tab" id="tab-codex" aria-controls="panel-codex" aria-selected="false" data-client-tab="codex" tabindex="-1">Codex</button>
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
        <article class="mcp-client-panel" role="tabpanel" id="panel-header-token" aria-labelledby="tab-header-token" data-client-panel="header-token" hidden>
          <span class="mcp-client-label">HEADER TOKEN</span>
          <h3>Streamable HTTP 配置</h3>
          <pre><code data-config="header-token"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="header-token">复制配置</button>
          <p>适用于只能发送 <code>token</code> 请求头的平台。Token 不要写入 Git、URL 或公开文档。</p>
        </article>
        <article class="mcp-client-panel" role="tabpanel" id="panel-codex" aria-labelledby="tab-codex" data-client-panel="codex" hidden>
          <span class="mcp-client-label">CODEX</span>
          <h3>环境变量认证</h3>
          <pre><code data-config="codex"></code></pre>
          <button class="mcp-copy" type="button" data-copy-config="codex">复制命令</button>
          <p>Token 只进入环境变量；Codex 配置仅保存变量名。完成后重新开启会话以加载最新 Tools。</p>
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
          <p>运行后会保存配置，并立即检查 Agenda MCP 是否可用。</p>
        </article>
      </div>
    </section>

    <section class="mcp-safety" aria-labelledby="mcp-safety-title">
      <header><span class="eyebrow">Safe by design</span><h2 id="mcp-safety-title">每次写入都有边界。</h2></header>
      <div class="mcp-safety-grid">
        <article><span>FAST</span><strong>低风险直写</strong><p>Draft 单项修改一次调用完成，并显示日期与期数。</p></article>
        <article><span>CONFIRM</span><strong>风险分级</strong><p>封版、批量、结构与级联操作展示简短摘要后确认一次。</p></article>
        <article><span>CONFLICT</span><strong>冲突保护</strong><p>目标未变时自动重试一次；目标变化则停止。</p></article>
        <article><span>RECOVER</span><strong>一键撤销</strong><p>无后续 revision 时可撤销最近一次 MCP 修改，否则直达 Admin。</p></article>
      </div>
      <a href="/">进入 Agenda <span aria-hidden="true">→</span></a>
    </section>

    <dialog class="mcp-token-dialog" data-token-request-dialog>
      <form data-token-request-form>
        <span class="eyebrow">Trial request</span>
        <h2>申请会议管理者 Token</h2>
        <p>编辑能力仅向获授权的 VPE 与 Meeting Manager 开放。俱乐部 VPE 将通过该名称审核申请。</p>
        <label for="mcp-trial-name">用户名</label>
        <input id="mcp-trial-name" name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="例如 Jordan Lee">
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
        <p>确认后写入俱乐部飞书 Base。请通知 VPE 审核并勾选 Enabled；启用后可读取并编辑 Draft 与确认后的 Final meeting。</p>
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
    "vpe-agenda": {
      "type": "http",
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer ${value}"
      }
    }
  }
}`,
    "header-token": `{
  "mcpServers": {
    "vpe_agenda": {
      "type": "streamable-http",
      "url": "${endpoint}",
      "headers": {
        "token": "${value}"
      }
    }
  }
}`,
    codex: `read -s VPE_AGENDA_MCP_TOKEN
export VPE_AGENDA_MCP_TOKEN
codex mcp add vpe_agenda --url ${endpoint} \\
  --bearer-token-env-var VPE_AGENDA_MCP_TOKEN
codex mcp get vpe_agenda --json`,
    claude: `claude mcp add --scope user --transport http \\\n  vpe-agenda ${endpoint} \\\n  --header "Authorization: Bearer ${value}"`,
    feishu: `请求地址  ${endpoint}\n请求头    Authorization\n类型      用户输入\n值        Bearer ${value}`,
    kimi: `kimi mcp add --transport http vpe-agenda \\\n  ${endpoint} \\\n  --header "Authorization: Bearer ${value}"`,
    openclaw: `openclaw mcp set vpe-agenda '${JSON.stringify({
      url: endpoint,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${value}` },
    })}'\nopenclaw mcp doctor vpe-agenda --probe`,
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
    const call = async (id, method, params = {}) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error();
      return body.result;
    };
    await call(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "vpe-agenda-setup", version: "1" },
    });
    const listed = await call(2, "tools/list");
    const required = ["get_role_booking_context", "search_pathways_projects", "book_role", "create_booking_goal", "propose_role_booking_change", "apply_role_booking_change"];
    if (!required.every((name) => listed.tools?.some((tool) => tool.name === name))) throw new Error();
    status.textContent = "连接成功：Agenda + Role Booking MCP ready。";
    status.className = "mcp-token-status ok";
  } catch {
    status.textContent = "连接失败：确认 Token 已启用，并重新扫描 MCP Tools。";
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
  `请帮我配置 VPE Agenda MCP。\nMCP endpoint: ${endpoint}\nTransport: Streamable HTTP\n认证：ChatGPT Work 使用 OAuth；WorkBuddy 等其他客户端使用 Authorization: Bearer <我的个人Token>。WorkBuddy 用户级配置写入 ~/.workbuddy/mcp.json。\n配置后调用 initialize 和 tools/list，确认包含 list_meetings、generate_signup_text、change_agenda、undo_last_agenda_change、get_role_booking_context、book_role、propose_role_booking_change、apply_role_booking_change、get_future_posters。Agenda Draft 单项修改直接执行；Final、批量与结构性修改先显示日期、期数和摘要，等我明确确认后再次调用 change_agenda。Role Booking 取消、转让与资料修改也必须先确认。不要把 Token 写入 Git、URL 或回答正文。`,
  event.currentTarget,
));

renderConfigs();
