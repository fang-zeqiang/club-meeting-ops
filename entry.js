const awardRoute = window.location.pathname.match(/^\/meetings\/([^/]+)\/awards\/present\/?$/);
const meetingPresentationRoute = window.location.pathname.match(/^\/meetings\/([^/]+)\/presentation\/?$/);
const shortAwardRoute = window.location.pathname.match(/^\/m\/(\d+)\/awards\/?$/);
const shortMeetingPresentationRoute = window.location.pathname.match(/^\/m\/(\d+)\/presentation\/?$/);
const posterPresentationRoute = window.location.pathname.match(/^\/(?:m\/(\d+)\/)?posters\/?$/);
const bookingRoute = window.location.pathname.match(/^\/book\/?$/);
const mcpRoute = window.location.pathname.match(/^\/mcp\/?$/);

if (mcpRoute) {
  import("./mcp-page.js");
} else if (bookingRoute) {
  import("./book.js");
} else if (meetingPresentationRoute || shortMeetingPresentationRoute || posterPresentationRoute) {
  import("./meeting-presentation.js");
} else if (awardRoute || shortAwardRoute) {
  import("./award-presentation.css");
  import("./award-presentation.js");
} else {
  import("./app.js");
}
