// 投屏页 Table Topics 名单的后台同步：本地先改先显示，请求在后台串行发出。
// 同一时刻最多一个请求；请求期间的多次改动只保留最新的完整名单，结束后一次提交，
// 新名单（如 4 人）直接覆盖旧名单（如 2 人），不逐条补发。
export function createLatestWinsSync({ send, onSynced = () => {}, onStateChange = () => {} }) {
  let inflight = false;
  let pending = null;
  let failed = null;
  let status = "idle";
  let error = null;
  let idleWaiters = [];

  const setStatus = (next, nextError = null) => {
    status = next;
    error = nextError;
    onStateChange({ status, error });
  };

  async function flush() {
    if (inflight || !pending) return;
    const snapshot = pending;
    pending = null;
    failed = null;
    inflight = true;
    if (status !== "syncing") setStatus("syncing");
    try {
      const result = await send(snapshot);
      inflight = false;
      // 还有更新的快照排队时，这次响应已过时，不能回写覆盖本地
      if (!pending) {
        onSynced(result);
        setStatus("synced");
      }
    } catch (sendError) {
      inflight = false;
      if (!pending) {
        failed = snapshot;
        setStatus("error", sendError);
      }
    }
    if (pending) flush();
    else {
      idleWaiters.forEach((resolve) => resolve());
      idleWaiters = [];
    }
  }

  function push(snapshot) {
    pending = snapshot;
    flush();
  }

  return {
    push,
    retry() { if (failed && !pending && !inflight) push(failed); },
    state: () => ({ status, error }),
    // 有未落库的本地改动时，轮询拿到的服务端数据不能覆盖本地
    hasLocalChanges: () => inflight || Boolean(pending) || Boolean(failed),
    whenIdle: () => (inflight || pending ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve()),
  };
}
