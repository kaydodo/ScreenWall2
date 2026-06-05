const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const crypto = require('crypto');
const path = require('path');

const ALARM_KEYWORDS_2CHAR = [
  '网络', '络错', '请重', '新登', '络有', '有问', '检测', '检查', '一下', '下吧',
];
const ALARM_KEYWORDS_3CHAR = [
  '网络错', '请重新', '网络有', '检测一', '查一下', '检测吧',
];

function preprocessOcrText(text) {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。？！.,?!]/g, '')
    .toLowerCase();
}

function matchAlarmKeywords(text) {
  const processedText = preprocessOcrText(text);
  for (const keyword of ALARM_KEYWORDS_3CHAR) {
    if (processedText.includes(keyword)) return keyword;
  }
  let matchCount = 0;
  const matchedKeywords = [];
  for (const keyword of ALARM_KEYWORDS_2CHAR) {
    if (processedText.includes(keyword)) {
      matchedKeywords.push(keyword);
      matchCount++;
      if (matchCount >= 2) return matchedKeywords[0];
    }
  }
  return null;
}

function findConnectedRegions(mask, w, h) {
  const visited = new Uint8Array(w * h);
  const regions = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (!mask[si] || visited[si]) continue;
      const queue = [si];
      const pixels = [si];
      visited[si] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (queue.length > 0) {
        const ci = queue.shift();
        const cx = ci % w;
        const cy = Math.floor(ci / w);
        const neighbors = [ci - 1, ci + 1, ci - w, ci + w];
        for (const ni of neighbors) {
          if (ni < 0 || ni >= w * h) continue;
          const ny = Math.floor(ni / w);
          if ((ni === ci - 1 || ni === ci + 1) && ny !== cy) continue;
          if (!visited[ni] && mask[ni]) {
            visited[ni] = 1;
            queue.push(ni);
            pixels.push(ni);
            const nx = ni % w;
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
          }
        }
      }
      regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area: pixels.length });
    }
  }
  return regions;
}

async function extractRegion(imageBuffer, x, y, width, height) {
  return await sharp(imageBuffer)
    .extract({ left: Math.max(0, x), top: Math.max(0, y), width: Math.max(1, width), height: Math.max(1, height) })
    .png()
    .toBuffer();
}

async function ocrRegion(imageBuffer) {
  try {
    const fixedBuffer = await sharp(imageBuffer)
      .withMetadata({ density: 72 })
      .png()
      .toBuffer();
    const result = await Tesseract.recognize(fixedBuffer, 'chi_sim', {
      logger: () => {},
      errorHandler: () => {},
    });
    return result.data.text.trim();
  } catch (e) {
    return '';
  }
}

async function compareImages(buffer1, buffer2) {
  try {
    const img1 = await sharp(buffer1).resize(150, 60).raw().toBuffer({ resolveWithObject: true });
    const img2 = await sharp(buffer2).resize(150, 60).raw().toBuffer({ resolveWithObject: true });
    const data1 = img1.data;
    const data2 = img2.data;
    let sumDiff = 0;
    const len = Math.min(data1.length, data2.length);
    for (let i = 0; i < len; i++) {
      sumDiff += Math.abs(data1[i] - data2[i]);
    }
    const maxDiff = len * 255;
    return 1 - (sumDiff / maxDiff);
  } catch (e) {
    return 0;
  }
}

async function processAlarmImage(imageBuffer, templateBuffer, templateRegion) {
  const now = Date.now();
  
  if (templateBuffer && templateRegion) {
    const { x1, y1, x2, y2 } = templateRegion;
    const metadata = await sharp(imageBuffer).metadata();
    const clampedX1 = Math.max(0, Math.min(x1, metadata.width));
    const clampedY1 = Math.max(0, Math.min(y1, metadata.height));
    const clampedX2 = Math.max(0, Math.min(x2, metadata.width));
    const clampedY2 = Math.max(0, Math.min(y2, metadata.height));
    const newRegionBuffer = await extractRegion(imageBuffer, clampedX1, clampedY1, clampedX2 - clampedX1, clampedY2 - clampedY1);
    const similarity = await compareImages(templateBuffer, newRegionBuffer);
    return { type: 'verify', similarity, shouldEnd: similarity < 0.9 };
  }
  
  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;
  const centerW = imgW;
  const centerH = imgH;
  
  const { data: centerData } = await sharp(imageBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const tolerance = 30;
  const targetR = 240, targetG = 240, targetB = 240;
  const mask = new Uint8Array(centerW * centerH);
  let maskCount = 0;
  
  for (let y = 0; y < centerH; y++) {
    for (let x = 0; x < centerW; x++) {
      const idx = (y * centerW + x) * 3;
      const r = centerData[idx];
      const g = centerData[idx + 1];
      const b = centerData[idx + 2];
      if (Math.abs(r - targetR) <= tolerance && 
          Math.abs(g - targetG) <= tolerance && 
          Math.abs(b - targetB) <= tolerance) {
        mask[y * centerW + x] = 1;
        maskCount++;
      }
    }
  }
  
  if (maskCount < 100) {
    return { type: 'detect', alarm: false, reason: 'maskCount < 100' };
  }
  
  const regions = findConnectedRegions(mask, centerW, centerH);
  
  const targetSizes = [{ w: 173, h: 160 }, { w: 173, h: 130 }];
  const sizeTolerance = 0.10;
  const validRegions = [];
  
  for (const reg of regions) {
    for (const target of targetSizes) {
      const wMin = target.w * (1 - sizeTolerance);
      const wMax = target.w * (1 + sizeTolerance);
      const hMin = target.h * (1 - sizeTolerance);
      const hMax = target.h * (1 + sizeTolerance);
      if (reg.w >= wMin && reg.w <= wMax && reg.h >= hMin && reg.h <= hMax) {
        validRegions.push({ ...reg, targetSize: target });
        break;
      }
    }
  }
  
  if (validRegions.length === 0) {
    return { type: 'detect', alarm: false, reason: 'no valid region' };
  }
  
  const reg = validRegions[0];
  const x1 = reg.x;
  const y1 = reg.y;
  const x2 = Math.min(imgW, reg.x + reg.w);
  const y2 = Math.min(imgH, reg.y + reg.h);
  
  const regionBuffer = await extractRegion(imageBuffer, x1, y1, x2 - x1, y2 - y1);
  
  let ocrText = '';
  try {
    ocrText = await ocrRegion(regionBuffer);
  } catch (e) {}
  
  const matchedKeyword = matchAlarmKeywords(ocrText);
  if (!matchedKeyword) {
    return { type: 'detect', alarm: false, reason: 'no keyword match' };
  }
  
  const imageMd5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
  
  return {
    type: 'detect',
    alarm: true,
    matchedKeyword,
    region: { x1, y1, x2, y2 },
    regionSize: { w: reg.w, h: reg.h },
    templateBuffer: regionBuffer,
    templateRegion: { x1, y1, x2, y2 },
    imageMd5,
    timestamp: now
  };
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'processAlarm') {
    try {
      const result = await processAlarmImage(msg.imageBuffer, msg.templateBuffer, msg.templateRegion);
      parentPort.postMessage({ 
        type: 'alarmResult', 
        deviceId: msg.deviceId, 
        imageBuffer: msg.imageBuffer,
        result 
      });
    } catch (e) {
      parentPort.postMessage({ type: 'alarmError', deviceId: msg.deviceId, error: e.message });
    }
  }
});

parentPort.postMessage({ type: 'workerReady' });