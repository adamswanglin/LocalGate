/**
 * 日志写入队列：把 better-sqlite3 的同步写从请求关键路径上剥离。
 *
 * better-sqlite3 的 insert 是同步阻塞调用，若在响应返回前执行会拖慢对外代理。
 * 这里用 setImmediate 把写延后到下一个事件循环 tick（响应已先发出去），
 * 并把同一 tick 内积压的写批量串行执行。
 */
type WriteTask = () => void;

const queue: WriteTask[] = [];
let scheduled = false;

function flush() {
  scheduled = false;
  const tasks = queue.splice(0, queue.length);
  for (const task of tasks) {
    try {
      task();
    } catch (e) {
      console.error('[log write failed]', e);
    }
  }
}

/** 把一次写库操作排入队列，立即返回（不阻塞调用方）。 */
export function enqueueWrite(task: WriteTask): void {
  queue.push(task);
  if (!scheduled) {
    scheduled = true;
    setImmediate(flush);
  }
}
