// The fixture's client entry, written the way a real app writes one: a bare
// specifier the import map resolves. Never executed by the suite -- it is
// served as text, and L6 walks it as the root of the module graph.
import { start } from "lautjs/client";

start({ registry: {} } as never);
