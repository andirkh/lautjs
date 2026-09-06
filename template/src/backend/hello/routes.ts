// Backend endpoints for one domain. Everything under src/backend/ is private:
// Laut refuses to serve it to the browser, so queries and credentials can live
// here safely. Import it from routes.ts and spread it in.
import { badRequest, route } from "lautjs";

export const helloRoutes = {
  "/api/hello/:name": {
    GET: route((req: Bun.BunRequest<"/api/hello/:name">) => {
      const { name } = req.params;
      // Throw an HttpError and it becomes that status; return data and it is
      // serialised to JSON. Anything else is a 500 with the detail kept here.
      if (name.length > 40) throw badRequest("name is too long");
      return { hello: name };
    }),
  },
};
