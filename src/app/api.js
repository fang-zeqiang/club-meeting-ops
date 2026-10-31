import { createApiJson } from "../shared/api-client.js";
import { DEMO_MODE } from "./contract.js";

export const apiJson = createApiJson(DEMO_MODE ? {
  demoHandler: async () => {
    const error = new Error("Unavailable in demo. No request was sent.");
    error.status = 403;
    error.code = "DEMO_NETWORK_BLOCKED";
    throw error;
  },
} : {});
