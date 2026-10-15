import type { WorkersAi } from "./ai.js";
import { createD1Store, type D1Database } from "./d1.js";
import { handleStrands } from "./handle.js";

export interface Env {
  DB: D1Database;
  AI?: WorkersAi;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleStrands(request, createD1Store(env.DB), Date.now(), env.AI);
  },
};
