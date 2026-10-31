import "./theme.css";
import { bindThemeSwitcher, initTheme } from "./theme.js";

initTheme();
bindThemeSwitcher();

const awardRoute = window.location.pathname.match(/^\/meetings\/([^/]+)\/awards\/present\/?$/);
const meetingPresentationRoute = window.location.pathname.match(/^\/meetings\/([^/]+)\/presentation\/?$/);
const shortAwardRoute = window.location.pathname.match(/^\/m\/(\d+)\/awards\/?$/);
// /m/:number/presentation/remote must win before desktop Presentation.
const presentationRemoteRoute = window.location.pathname.match(/^\/m\/(\d+)\/presentation\/remote\/?$/);
const shortMeetingPresentationRoute = window.location.pathname.match(/^\/m\/(\d+)\/presentation\/?$/);
const posterPresentationRoute = window.location.pathname.match(/^\/(?:m\/(\d+)\/)?posters\/?$/);
const bookingRoute = window.location.pathname.match(/^\/book\/?$/);
const bookingDemoRoute = window.location.pathname.match(/^\/book\/demo\/?$/);
const mcpRoute = window.location.pathname.match(/^\/mcp\/?$/);
const demoRoute = window.location.pathname.match(/^\/demo\/?$/);
const aboutRoute = window.location.pathname.match(/^\/about\/?$/);

if (bookingDemoRoute) {
  import("./book.js");
} else if (demoRoute) {
  import("./app.js");
} else if (aboutRoute) {
  import("./about-page.js");
} else if (mcpRoute) {
  import("./mcp-page.js");
} else if (bookingRoute) {
  import("./book.js");
} else if (presentationRemoteRoute) {
  import("./presentation-remote-page.js");
} else if (meetingPresentationRoute || shortMeetingPresentationRoute || posterPresentationRoute) {
  import("./meeting-presentation.js");
} else if (awardRoute || shortAwardRoute) {
  const target = awardRoute ? `/meetings/${encodeURIComponent(awardRoute[1])}/presentation?jump=awards` : `/m/${encodeURIComponent(shortAwardRoute[1])}/presentation?jump=awards`;
  location.replace(`${target}${location.hash}`);
} else {
  import("./app.js");
}
