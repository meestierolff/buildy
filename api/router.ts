import { handleApiRequest } from "../server/http/router.js";
import { ensureServerComposition } from "../server/composition.js";

const REWRITE_PATH_PARAMETER = "__buildy_api_path";

export function restoreRewrittenApiRequest(request: Request): Request {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get(REWRITE_PATH_PARAMETER);
  if (rewrittenPath === null) return request;

  url.searchParams.delete(REWRITE_PATH_PARAMETER);
  if (
    !/^[a-zA-Z0-9/_-]*$/.test(rewrittenPath) ||
    rewrittenPath.includes("..") ||
    rewrittenPath.includes("//")
  ) {
    url.pathname = "/api/__invalid_rewrite";
  } else {
    url.pathname = `/api/${rewrittenPath.replace(/^\/+/, "")}`;
  }

  return new Request(url, request);
}

export default {
  fetch(request: Request): Promise<Response> {
    ensureServerComposition();
    return handleApiRequest(restoreRewrittenApiRequest(request));
  },
};
