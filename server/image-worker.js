const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');

parentPort.on('message', async (task) => {
  if (task.type === 'resize') {
    try {
      const result = await sharp(task.buffer)
        .resize(task.width, task.height, { fit: 'cover' })
        .webp({ quality: 30 })
        .toBuffer();
      parentPort.postMessage({
        id: task.id,
        success: true,
        buffer: result,
        width: task.width,
        height: task.height
      });
    } catch (e) {
      parentPort.postMessage({
        id: task.id,
        success: false,
        error: e.message,
        originalBuffer: task.buffer,
        originalWidth: task.originalWidth,
        originalHeight: task.originalHeight
      });
    }
  }
});
