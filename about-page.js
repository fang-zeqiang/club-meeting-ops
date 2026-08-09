import "./about.css";

const app = document.querySelector("#app");
const githubUrl = "https://github.com";
const images = {
  workspace: new URL("./assets/about/workspace-demo.png", import.meta.url).href,
  presentation: new URL("./assets/about/presentation-demo.jpg", import.meta.url).href,
  voting: new URL("./assets/about/voting-demo.jpg", import.meta.url).href,
  pdf: new URL("./assets/about/pdf-demo.jpg", import.meta.url).href,
  admin: new URL("./assets/about/workspace-demo-admin.png", import.meta.url).href,
  book: new URL("./assets/about/role-book-demo.png", import.meta.url).href,
};

const copy = {
  en: {
    lang: "en",
    title: "Club Meeting Ops | One record powers the whole meeting",
    description: "Role Book, Meeting Workspace, and MCP maintain one meeting record that powers Agenda, Presentation, Voting, Awards, and A4 materials.",
    languageLabel: "Language",
    languagePrompt: "English and Chinese available.",
    navLabel: "Club Meeting Ops navigation",
    homeLabel: "Club Meeting Ops home",
    navSystem: "System",
    navProducts: "Products",
    navMemory: "Meeting memory",
    heroTitle: "Update the Agenda once.<br>Every meeting asset follows.",
    heroLede: "One Agenda record stays consistent across tools, updating Presentation, the Voting QR code, Awards, and PDF together. Each deployment preserves the club's familiar Agenda structure, logo, colors, and layout, reducing repetitive work for the Office Team.",
    openSource: "Visit GitHub",
    tryDemo: "Open workspace",
    seeWorkflow: "See how it works",
    heroOutputData: "One Agenda record",
    heroOutputs: [
      ["workspace", "Meeting Workspace", "Meeting Advisor workspace using fictional demo data"],
      ["presentation", "Presentation", "Meeting Presentation generated from fictional demo Agenda data"],
      ["voting", "Voting QR Code", "Voting QR code slide generated from fictional demo Agenda data"],
      ["pdf", "PDF / A4", "A4 Agenda generated from fictional demo Agenda data"],
    ],
    systemTitle: "Not separate tools.<br>One meeting data flow.",
    systemBody: "Role Book, Meeting Workspace, and MCP update a shared meeting core. Live outputs read it, then Voting writes confirmed results back.",
    systemLabel: "Club Meeting Ops system relationship",
    systemInputs: [
      ["Members", "Role Book", "Book roles and set personal goals"],
      ["Meeting team", "Meeting Workspace", "Advisor guidance and Admin actions"],
      ["Agent", "MCP", "Natural-language access and controlled edits"],
    ],
    systemFields: "Meetings, Blocks, Items, Members, Assets",
    outputsLabel: "Meeting outputs",
    systemReturn: "Voting results and confirmed awards return to the meeting record",
    productsTitle: "Multiple entry points.<br>One meeting stays current.",
    productsBody: "All three products share the same meeting record. Start with the task you need now.",
    memberEntry: "Club members",
    roleBookBody: "See upcoming meetings and book the role that fits you.",
    roleBookDemo: "Open Role Book",
    roleBookLogin: "Open Role Book",
    roleBookDemoLabel: "Try Role Book with fictional browser-only data",
    roleBookAlt: "Role Book meeting booking page on a mobile screen",
    teamEntry: "VPE and meeting team",
    workspaceBody: "Edit the Agenda once and keep every meeting asset in sync. Each club gets a branded deployment.",
    workspaceDemo: "Open workspace",
    workspaceLogin: "Already have a workspace? Sign in",
    workspaceDemoLabel: "Try the Meeting Workspace with fictional demo data",
    adminAlt: "Meeting Workspace with Admin controls and a live A4 preview",
    agentEntry: "Agent users",
    mcpBody: "Request changes in conversation. Write only after confirming the diff.",
    mcpCta: "Use MCP",
    mcpChatLabel: "Agenda orchestration conversation",
    mcpUser: "Change the meeting host to Alex and move the opening to 19:05.",
    mcpProposal: "I will change 2 items:",
    mcpChanges: ["Host: Jordan → Alex", "Opening: 19:00 → 19:05"],
    mcpSafety: "No data has changed. Confirm to write these changes.",
    mcpWaiting: "Confirm changes",
    lifecycleTitle: "From publishing a meeting to preserving its record.",
    lifecycle: [
      ["Before", "Book and prepare", "Members choose roles, the VPE maintains the Agenda, and Advisor checks readiness."],
      ["During", "Present and vote", "Presentation reads the latest Agenda. Voting uses the same candidates."],
      ["After", "Recognize and review", "Awards preserve confirmed results. Review records issues and improvements."],
    ],
    outputTitle: "Update once. Every live output follows.",
    outputBody: "Stop editing the Agenda, projection deck, voting candidates, awards page, and print file separately.",
    outputLabel: "Meeting data outputs",
    meetingBrain: "Meeting brain",
    memoryTitle: "The meeting ends. Its data stays.",
    memoryBody: "Each meeting preserves its structure, roles, votes, awards, and review. Over time, the club can understand member experience, goal progress, and meeting quality.",
    memoryNote: "Cross-meeting analysis is a future capability. This page does not show invented metrics.",
    memoryLabels: ["Roles", "Voting", "Awards", "Feedback"],
    openTitle: "Turn repeated syncing into one workflow.",
    openBody: "Club Meeting Ops uses the MIT License. Each club deploys its own instance, Base, and credentials.",
    footer: "Independent open-source project for volunteer clubs.",
  },
  zh: {
    lang: "zh-CN",
    title: "Club Meeting Ops | 一份数据驱动整场会议",
    description: "Role Book、Meeting Workspace 与 MCP 共同维护会议数据，驱动 Agenda、Presentation、Voting、Awards 与 A4 材料。",
    languageLabel: "语言",
    languagePrompt: "提供中文与英文版本。",
    navLabel: "Club Meeting Ops 导航",
    homeLabel: "Club Meeting Ops 首页",
    navSystem: "系统关系",
    navProducts: "产品入口",
    navMemory: "会议记忆",
    heroTitle: "改一次 Agenda，<br>会议物料一起更新",
    heroLede: "多端维护同一份 Agenda 数据，联动更新 Presentation、Voting QR Code、Award 与 PDF。部署时保留俱乐部熟悉的 Agenda 结构、Logo、配色和版式，减少 Office Team 重复维护。",
    openSource: "访问 GitHub",
    tryDemo: "进入工作区",
    seeWorkflow: "了解工作流",
    heroOutputData: "同一份 Agenda 数据",
    heroOutputs: [
      ["workspace", "Meeting Workspace", "使用虚构演示数据的 Meeting Advisor 工作台"],
      ["presentation", "Presentation", "由虚构演示 Agenda 数据生成的 Presentation"],
      ["voting", "Voting QR Code", "由虚构演示 Agenda 数据生成的 Voting QR Code 页面"],
      ["pdf", "PDF / A4", "由虚构演示 Agenda 数据生成的 A4 Agenda"],
    ],
    systemTitle: "不是一组孤立工具。<br>是一条会议数据链。",
    systemBody: "Role Book、Meeting Workspace 与 MCP 写入共享会议核心。现场材料读取最新状态，Voting 再把结果带回来。",
    systemLabel: "Club Meeting Ops 系统关系",
    systemInputs: [
      ["会员", "Role Book", "预约角色与个人目标"],
      ["会议团队", "Meeting Workspace", "Advisor 指引与 Admin 操作"],
      ["Agent", "MCP", "自然语言读取与受控编辑"],
    ],
    systemFields: "Meetings、Blocks、Items、Members、Assets",
    outputsLabel: "会议输出",
    systemReturn: "Voting 结果与奖项确认回写会议记录",
    productsTitle: "多端入口<br>更新同一场会议",
    productsBody: "三个入口共享同一份会议记录。先选择你现在要完成的事，再进入对应产品。",
    memberEntry: "俱乐部会员",
    roleBookBody: "查看每期会议，直接预约适合自己的角色。",
    roleBookDemo: "进入 Role Book",
    roleBookLogin: "进入 Role Book",
    roleBookDemoLabel: "使用仅保存在浏览器中的虚构数据体验 Role Book",
    roleBookAlt: "手机中的 Role Book 会议预约页面",
    teamEntry: "VPE 与会议团队",
    workspaceBody: "编辑一次 Agenda，多种会议物料同步更新。支持按俱乐部品牌定制部署。",
    workspaceDemo: "进入工作区",
    workspaceLogin: "已有工作区？登录",
    workspaceDemoLabel: "使用虚构数据体验 Meeting Workspace",
    adminAlt: "Meeting Workspace 中 Admin 与 A4 实时预览",
    agentEntry: "Agent 用户",
    mcpBody: "通过对话提出修改，确认差异后安全写入。",
    mcpCta: "使用 MCP",
    mcpChatLabel: "Agenda 对话式编排",
    mcpUser: "把主持人改为 Alex，并更新开场时间。",
    mcpProposal: "我会修改 2 项：",
    mcpChanges: ["主持人：Jordan → Alex", "开场：19:00 → 19:05"],
    mcpSafety: "数据尚未修改。确认后写入。",
    mcpWaiting: "确认后写入",
    lifecycleTitle: "从上架会议，到留下记录。",
    lifecycle: [
      ["会前", "预约与筹备", "会员选角色，VPE 维护 Agenda，Advisor 检查准备状态。"],
      ["会中", "展示与投票", "Presentation 读取最新议程，Voting 使用同一份候选人。"],
      ["会后", "奖项与复盘", "Awards 固化确认结果，Review 保存问题与改进。"],
    ],
    outputTitle: "改一次，所有现场材料一起更新。",
    outputBody: "不再分别修改议程网页、投影页、投票候选人、奖项页与打印文件。",
    outputLabel: "会议数据输出形式",
    meetingBrain: "会议大脑",
    memoryTitle: "一次会议结束，数据没有消失。",
    memoryBody: "每场会议保存结构、角色、投票、奖项与复盘。长期积累后，可进一步理解会员经历、目标进展与会议质量。",
    memoryNote: "跨会议分析属于长期能力，当前页面不展示虚构指标。",
    memoryLabels: ["角色", "投票", "奖项", "反馈"],
    openTitle: "把重复同步，变成一条工作流。",
    openBody: "Club Meeting Ops 使用 MIT License。每个俱乐部部署自己的实例、Base 与凭证。",
    footer: "面向志愿者俱乐部的独立开源项目。",
  },
};

function render(locale) {
  const text = copy[locale];
  const otherLocale = locale === "en" ? "zh" : "en";
  const initialOutput = text.heroOutputs[0];

  document.title = text.title;
  document.documentElement.lang = text.lang;
  document.body.className = "about-page";
  document.querySelector('meta[name="description"]')?.setAttribute("content", text.description);

  app.innerHTML = `
    <aside class="about-language-bar" aria-label="${text.languageLabel}">
      <p>${text.languagePrompt}</p>
      <div class="about-language-switch" role="group" aria-label="${text.languageLabel}">
        <button type="button" data-locale="en" aria-pressed="${locale === "en"}">English</button>
        <button type="button" data-locale="zh" aria-pressed="${locale === "zh"}">中文</button>
      </div>
    </aside>

    <main class="about-shell">
      <nav class="about-nav" aria-label="${text.navLabel}">
        <a class="about-brand" href="/about" aria-label="${text.homeLabel}">
          <span aria-hidden="true">C</span>
          <strong>Club Meeting Ops</strong>
        </a>
        <div class="about-nav-links">
          <a href="#system">${text.navSystem}</a>
          <a href="#products">${text.navProducts}</a>
          <a href="#memory">${text.navMemory}</a>
        </div>
      </nav>

      <section class="about-hero" aria-labelledby="about-title">
        <div class="about-hero-copy">
          <p class="about-kicker">Club Meeting Ops</p>
          <h1 id="about-title">${text.heroTitle}</h1>
          <p class="about-hero-lede">${text.heroLede}</p>
          <div class="about-actions">
            <a class="about-button primary" href="/">${text.tryDemo}</a>
            <a class="about-button secondary" href="#system">${text.seeWorkflow}</a>
          </div>
        </div>
        <figure class="about-hero-media">
          <img data-hero-output-image src="${images[initialOutput[0]]}" alt="${initialOutput[2]}" width="1280" height="720" fetchpriority="high">
          <figcaption>
            <strong>${text.heroOutputData}</strong>
            <div class="hero-output-switch" role="group" aria-label="${text.outputLabel}">
              ${text.heroOutputs.map(([key, label], index) => `<button type="button" data-hero-output="${key}" aria-pressed="${index === 0}">${label}</button>`).join("")}
            </div>
            <span class="visually-hidden" data-hero-output-status aria-live="polite">${initialOutput[1]}</span>
          </figcaption>
        </figure>
      </section>

      <section class="about-products" id="products" aria-labelledby="products-title">
        <header class="about-section-heading compact">
          <h2 id="products-title">${text.productsTitle}</h2>
          <p>${text.productsBody}</p>
        </header>

        <div class="product-entry-grid">
          <article class="product-entry role-book-entry">
            <a class="product-entry-media-link" href="/book" aria-label="${text.roleBookDemoLabel}">
              <div class="product-entry-media role-book-media">
                <div class="iphone-frame">
                  <span class="iphone-island" aria-hidden="true"></span>
                  <img src="${images.book}" alt="${text.roleBookAlt}" loading="lazy">
                </div>
              </div>
            </a>
            <div class="product-entry-copy">
              <span class="product-index">${text.memberEntry}</span>
              <h3>Role Book</h3>
              <p>${text.roleBookBody}</p>
              <div class="product-entry-actions">
                <a class="product-entry-button" href="/book">${text.roleBookDemo}</a>
              </div>
            </div>
          </article>

          <article class="product-entry workspace-entry">
            <a class="product-entry-media-link" href="/" aria-label="${text.workspaceDemoLabel}">
              <div class="product-entry-media workspace-media">
                <div class="macbook-frame">
                  <div class="macbook-screen">
                    <span class="macbook-camera" aria-hidden="true"></span>
                    <img src="${images.admin}" alt="${text.adminAlt}" loading="lazy">
                  </div>
                  <div class="macbook-base" aria-hidden="true"><span></span></div>
                </div>
              </div>
            </a>
            <div class="product-entry-copy">
              <span class="product-index">${text.teamEntry}</span>
              <h3>Meeting Workspace</h3>
              <p>${text.workspaceBody}</p>
              <div class="product-entry-actions">
                <a class="product-entry-button" href="/">${text.workspaceDemo}</a>
              </div>
            </div>
          </article>

          <a class="product-entry mcp-entry" href="/mcp">
            <div class="product-entry-media mcp-media">
              <div class="mcp-phone">
                <span class="mcp-phone-island" aria-hidden="true"></span>
                <div class="agent-preview" aria-label="${text.mcpChatLabel}">
                  <header><span class="agent-mark" aria-hidden="true">A</span><strong>Agenda Agent</strong></header>
                  <div class="agent-message user">${text.mcpUser}</div>
                  <div class="agent-message assistant">
                    <strong>${text.mcpProposal}</strong>
                    <div class="agent-diff">${text.mcpChanges.map((change) => `<span><i aria-hidden="true">+</i>${change}</span>`).join("")}</div>
                    <p>${text.mcpSafety}</p>
                  </div>
                  <footer><strong>${text.mcpWaiting}</strong></footer>
                </div>
              </div>
            </div>
            <div class="product-entry-copy">
              <span class="product-index">${text.agentEntry}</span>
              <h3>MCP</h3>
              <p>${text.mcpBody}</p>
              <span class="product-entry-cta">${text.mcpCta} <span aria-hidden="true">→</span></span>
            </div>
          </a>
        </div>
      </section>

      <section class="about-system" id="system" aria-labelledby="system-title">
        <header class="about-section-heading">
          <h2 id="system-title">${text.systemTitle}</h2>
          <p>${text.systemBody}</p>
        </header>

        <div class="system-map" aria-label="${text.systemLabel}">
          <div class="system-inputs">
            ${text.systemInputs.map(([label, title, body]) => `<article><span>${label}</span><strong>${title}</strong><small>${body}</small></article>`).join("")}
          </div>
          <div class="system-core">
            <span>Single source of truth</span>
            <strong>Feishu / Lark Base</strong>
            <p>${text.systemFields}</p>
          </div>
          <div class="system-outputs" aria-label="${text.outputsLabel}">
            <span>Agenda</span><span>PDF / A4</span><span>Presentation</span><span>Voting</span><span>Awards</span>
          </div>
          <p class="system-return">${text.systemReturn} <span aria-hidden="true">↩</span></p>
        </div>
      </section>

      <section class="about-lifecycle" aria-labelledby="lifecycle-title">
        <header class="about-section-heading compact">
          <h2 id="lifecycle-title">${text.lifecycleTitle}</h2>
        </header>
        <div class="lifecycle-track">
          ${text.lifecycle.map(([label, title, body]) => `<article><span>${label}</span><h3>${title}</h3><p>${body}</p></article>`).join("")}
        </div>
      </section>

      <section class="about-output" aria-labelledby="output-title">
        <div class="output-copy">
          <h2 id="output-title">${text.outputTitle}</h2>
          <p>${text.outputBody}</p>
        </div>
        <div class="output-orbit" aria-label="${text.outputLabel}">
          <strong>Meeting record</strong>
          <span class="output-agenda">Agenda</span>
          <span class="output-pdf">PDF / A4</span>
          <span class="output-presentation">Presentation</span>
          <span class="output-voting">Voting</span>
          <span class="output-awards">Awards</span>
        </div>
      </section>

      <section class="about-memory" id="memory" aria-labelledby="memory-title">
        <div class="memory-visual" aria-hidden="true">
          <div class="memory-ring">
            ${text.memoryLabels.map((label) => `<span>${label}</span>`).join("")}
            <strong>Club<br>memory</strong>
          </div>
        </div>
        <div class="memory-copy">
          <p class="about-kicker">${text.meetingBrain}</p>
          <h2 id="memory-title">${text.memoryTitle}</h2>
          <p>${text.memoryBody}</p>
          <small>${text.memoryNote}</small>
        </div>
      </section>

      <section class="about-open-source">
        <div>
          <h2>${text.openTitle}</h2>
          <p>${text.openBody}</p>
        </div>
        <a class="about-button primary" href="${githubUrl}" target="_blank" rel="noreferrer">${text.openSource}</a>
      </section>

      <footer class="about-footer">
        <a class="about-brand" href="/about"><span aria-hidden="true">C</span><strong>Club Meeting Ops</strong></a>
        <p>${text.footer}</p>
        <div><a href="/book">Role Book</a><a href="/">Workspace</a><a href="/mcp">MCP</a></div>
      </footer>
    </main>
  `;

  app.querySelector(`[data-locale="${otherLocale}"]`)?.addEventListener("click", () => render(otherLocale));
  const outputImage = app.querySelector("[data-hero-output-image]");
  const outputStatus = app.querySelector("[data-hero-output-status]");
  app.querySelectorAll("[data-hero-output]").forEach((button) => {
    button.addEventListener("click", () => {
      const output = text.heroOutputs.find(([key]) => key === button.dataset.heroOutput);
      if (!output || button.getAttribute("aria-pressed") === "true") return;
      outputImage.classList.add("is-switching");
      outputImage.addEventListener("load", () => outputImage.classList.remove("is-switching"), { once: true });
      outputImage.src = images[output[0]];
      outputImage.alt = output[2];
      outputStatus.textContent = output[1];
      app.querySelectorAll("[data-hero-output]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    });
  });
}

render("en");
