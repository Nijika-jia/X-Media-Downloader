/**
 * 感知哈希 (pHash) 工具
 * 用于识别盗图、压缩图、截图等场景
 * 算法：图片 → 8x8 灰度 → 64位哈希指纹
 */

const HASH_SIZE = 8; // 8x8 = 64 bit

/**
 * 计算图片的 pHash
 * @param {string} imageUrl 图片 URL
 * @returns {Promise<string|null>} 64位十六进制哈希字符串，失败返回 null
 */
export function computePHash(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = HASH_SIZE;
        canvas.height = HASH_SIZE;
        const ctx = canvas.getContext('2d');

        // 缩小到 8x8
        ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);

        // 获取像素数据
        const imageData = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
        const pixels = imageData.data;

        // 转灰度并计算平均值
        const grays = [];
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          // ITU-R 601-2 luma 转换
          const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          grays.push(gray);
          sum += gray;
        }
        const avg = sum / grays.length;

        // 生成 64 位哈希
        let hash = '';
        for (let i = 0; i < grays.length; i++) {
          hash += grays[i] >= avg ? '1' : '0';
        }

        // 转十六进制字符串（更紧凑）
        const hexHash = binaryToHex(hash);
        resolve(hexHash);
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
