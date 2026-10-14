import type { APIRoute } from "astro";
import { render } from "../lib/og";

// iOS home-screen and some link previews use this instead of the SVG favicon.
export const GET: APIRoute = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0d0d0d"/><path d="M16 4l3.5 7v12L16 27l-3.5-4V11z" fill="#3987e5"/><path d="M12.5 19L9 24h3.5zm7 0l3.5 5h-3.5z" fill="#c3c2b7"/></svg>`;
  return new Response(render(svg, 180), { headers: { "Content-Type": "image/png" } });
};
