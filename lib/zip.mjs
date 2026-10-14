// A zip file from a list of { name, data }, with Node's own zlib: each file deflated (or stored, when deflating does
// not make it smaller), with its CRC-32, a local header, and the central directory at the end. Enough for Export to
// hand Claude a folder of files instead of one long one; no dependency for it.
import { deflateRawSync, crc32 } from 'node:zlib';

// The time as zip files keep it: the MS-DOS date and time, in local time, to two seconds.
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zip(entries, { at = new Date() } = {}) {
  const { time, date } = dosTime(at);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name).replace(/^\/+/, ''), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = deflateRawSync(raw);
    const store = deflated.length >= raw.length;
    const body = store ? raw : deflated, method = store ? 0 : 8, crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // version, flags: names are UTF-8
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); // made on Unix, so the mode below applies
    central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
