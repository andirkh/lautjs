// This rejects `import { a } from "./x.css"` but not `import a from "./x.css"`
declare module "*.css" { }
