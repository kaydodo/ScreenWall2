const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const NUM_WORKERS = Math.min(os.cpus().length, 8);

class ImageWorkerPool {
  constructor() {
    this.workers = [];
    this.taskQueue = [];
    this.taskCallbacks = new Map();
    this.taskId = 0;
    this.init();
  }

  init() {
    for (let i = 0; i < NUM_WORKERS; i++) {
      const worker = new Worker(path.join(__dirname, 'image-worker.js'));
      worker.on('message', (result) => {
        const callback = this.taskCallbacks.get(result.id);
        if (callback) {
          this.taskCallbacks.delete(result.id);
          callback(result);
        }
        this.processQueue();
      });
      worker.on('error', (err) => {
        console.error('[ImageWorker] Worker error:', err);
      });
      this.workers.push({ worker, busy: false });
    }
    console.log(`[ImageWorker] 已启动 ${NUM_WORKERS} 个工作线程`);
  }

  getAvailableWorker() {
    return this.workers.find(w => !w.busy);
  }

  processQueue() {
    if (this.taskQueue.length === 0) return;
    
    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) return;

    const task = this.taskQueue.shift();
    availableWorker.busy = true;
    this.taskCallbacks.set(task.id, (result) => {
      availableWorker.busy = false;
      task.callback(result);
    });
    availableWorker.worker.postMessage(task.data);
  }

  resize(buffer, width, height, originalWidth = 0, originalHeight = 0) {
    return new Promise((resolve) => {
      const id = ++this.taskId;
      const task = {
        id,
        data: {
          type: 'resize',
          id,
          buffer,
          width,
          height,
          originalWidth,
          originalHeight
        },
        callback: (result) => {
          if (result.success) {
            resolve({ buffer: result.buffer, width: result.width, height: result.height });
          } else {
            resolve({ buffer: result.originalBuffer, width: result.originalWidth, height: result.originalHeight });
          }
        }
      };

      const availableWorker = this.getAvailableWorker();
      if (availableWorker) {
        availableWorker.busy = true;
        this.taskCallbacks.set(id, task.callback);
        availableWorker.worker.postMessage(task.data);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  async resizeBatch(tasks) {
    return Promise.all(tasks.map(t => this.resize(t.buffer, t.width, t.height, t.originalWidth, t.originalHeight)));
  }
}

module.exports = new ImageWorkerPool();
