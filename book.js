import "./book.css";
import "./speaking-tip-card.css";
import { CLUB_PROFILE } from "./club-profile.js";
import { BOOK_DEMO_MODE } from "./src/book/state.js";
import { render } from "./src/book/render.js";
import { initialize } from "./src/book/actions.js";
import { bindBookEvents } from "./src/book/events.js";

document.title = BOOK_DEMO_MODE ? "Role Book Demo · Riverside Speakers Club" : `Role Book · ${CLUB_PROFILE.clubName}`;
document.documentElement.lang = "zh-CN";
document.body.className = "book-page";

bindBookEvents();
render();
initialize();
