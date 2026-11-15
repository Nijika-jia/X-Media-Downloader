/**
 * 感知哈希 (pHash) 工具
 * 同时生成 aHash（平均值哈希）与 dHash（水平梯度哈希），用于双指纹去重
 * 用于识别盗图、压缩图、截图等场景
 */

const A_SIZE = 8; // aHash：8x8 灰度 → 64 bit（与旧实现完全一致）
const D_WIDTH = 9; // dHash：9x8 灰度，每行相邻比较 → 64 bit
const D_HEIGHT = 8;

/**
 * 把图片缩到指定尺寸并转灰度矩阵
 */
function drawGray(img, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    gray.push(row);
  }
  return gray;
}

/**
 * 同时计算 aHash 与 dHash
 * @param {string} imageUrl 图片 URL
 * @returns {Promise<{phash: string, dhash: string}|null>} 两个 16 位十六进制哈希
 */
export function computeHashes(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // aHash：8x8 灰度与平均值比较（保持旧算法，兼容历史索引）
        const grayA = drawGray(img, A_SIZE, A_SIZE);
        let sum = 0;
        for (let y = 0; y < A_SIZE; y++) {
          for (let x = 0; x < A_SIZE; x++) {
            sum += grayA[y][x];
          }
        }
        const avg = sum / (A_SIZE * A_SIZE);
        let aBits = '';
        for (let y = 0; y < A_SIZE; y++) {
          for (let x = 0; x < A_SIZE; x++) {
            aBits += grayA[y][x] >= avg ? '1' : '0';
          }
        }

        // dHash：9x8 灰度，每行比较相邻像素的明暗变化
        const grayD = drawGray(img, D_WIDTH, D_HEIGHT);
        let dBits = '';
        for (let y = 0; y < D_HEIGHT; y++) {
          for (let x = 0; x < D_WIDTH - 1; x++) {
            dBits += grayD[y][x] > grayD[y][x + 1] ? '1' : '0';
          }
        }

        resolve({ phash: binaryToHex(aBits), dhash: binaryToHex(dBits) });
      } catch (e) {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);

    // 设置超时（避免卡死）
    setTimeout(() => resolve(null), 5000);

    img.src = imageUrl;
  });
}

/**
 * 兼容旧调用：只返回 aHash
 */
export function computePHash(imageUrl) {
  return computeHashes(imageUrl).then(hashes => (hashes ? hashes.phash : null));
}

/**
 * 二进制字符串转十六进制字符串
 */
function binaryToHex(binary) {
  let hex = '';
  for (let i = 0; i < binary.length; i += 4) {
    const chunk = binary.substr(i, 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

/**
 * 十六进制哈希转二进制字符串
 */
function hexToBinary(hex) {
  let binary = '';
  for (let i = 0; i < hex.length; i++) {
    const chunk = parseInt(hex[i], 16).toString(2).padStart(4, '0');
    binary += chunk;
  }
  return binary;
}

/**
 * 计算两个哈希的汉明距离（不同位数）
 * @param {string} hash1 十六进制哈希
 * @param {string} hash2 十六进制哈希
 * @returns {number} 汉明距离（0-64）
 */
export function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
  const bin1 = hexToBinary(hash1);
  const bin2 = hexToBinary(hash2);
  let distance = 0;
  for (let i = 0; i < bin1.length; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
}

/**
 * 判断两个哈希是否相似
 * @param {string} hash1
 * @param {string} hash2
 * @param {number} threshold 阈值（默认 5，越小越严格）
 * @returns {boolean}
 */
export function isSimilar(hash1, hash2, threshold = 5) {
  return hammingDistance(hash1, hash2) <= threshold;
}
