// 两个页面共用的同源 JSON 请求;demoHandler 存在时完全不发网络请求
export function createApiJson({ demoHandler = null, fallbackMessage = "Request failed." } = {}) {
  return async function apiJson(url, options = {}) {
    if (demoHandler) return demoHandler(url, options);
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || fallbackMessage);
      error.status = response.status;
      error.code = body.code;
      error.details = body.details;
      throw error;
    }
    return body;
  };
}
