// Application routes -- the file you edit when you add a page or an endpoint.
// Everything else (source transpiling, vendor modules, static files) is wired
// up by Laut inside createServer, and you can happily ignore it.
import { page } from "lautjs";
import { helloRoutes } from "./src/backend/hello/routes.ts";
import * as about from "./src/frontend/sea/pages/about/about.tsx";
import * as home from "./src/frontend/sea/pages/home/home.tsx";

export const routes = {
  // pages: a module with `default` (the component) and `title`
  "/": page(home),
  "/about": page(about),

  // backend endpoints, grouped per domain in src/backend/<domain>/routes.ts
  ...helloRoutes,
};
