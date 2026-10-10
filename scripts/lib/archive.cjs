'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const table = Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipDirectory(root, output) {
  const local = [], central = []; let offset = 0, count = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || entry.name === '.DS_Store' || entry.name.startsWith('._')) continue;
      const name = Buffer.from(path.relative(root, full).split(path.sep).join('/'));
      const data = fs.readFileSync(full), compressed = zlib.deflateRawSync(data), crc = crc32(data);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
      header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
      local.push(header, name, compressed);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(33, 14);
      record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20);
      record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE(offset, 42); central.push(record, name);
      offset += header.length + name.length + compressed.length; count++;
    }
  }
  walk(root);
  if (count > 65535 || offset > 0xffffffff) throw new Error('Archive exceeds ZIP32 limits');
  const centralSize = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(output, Buffer.concat([...local, ...central, end]));
}
module.exports = { zipDirectory, crc32 };
