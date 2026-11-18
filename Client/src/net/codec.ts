import * as sproto from "@nansnunen/sproto-js";

export interface ProtocolDef {
  name: string;
  tag: number;
  req?: string;
  res?: string;
}

export interface DecodedPackage {
  type?: number;
  session?: number;
  body: Uint8Array;
}

/** 与 skynet host:attach 对齐：pack( package头 ++ 业务体 )。 */
export class SprotoCodec {
  private sp!: ReturnType<typeof sproto.create>;
  private byName = new Map<string, ProtocolDef>();
  private byTag = new Map<number, ProtocolDef>();

  static async load(urls: string[]): Promise<SprotoCodec> {
    const parts: string[] = [];
    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`协议加载失败 ${url}`);
      parts.push(await res.text());
    }
    const schema = parts.join("\n").replace("ud 2 : string", "ud 2 : binary");
    const codec = new SprotoCodec();
    codec.sp = sproto.create(schema);
    codec.parse(schema);
    return codec;
  }

  private parse(schema: string): void {
    const re = /(\w+)\s+(\d+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(schema))) {
      const def: ProtocolDef = { name: m[1], tag: Number(m[2]) };
      const req = m[3].match(/request\s+(\w+)/);
      const res = m[3].match(/response\s+(\w+)/);
      if (req) def.req = req[1];
      if (res) def.res = res[1];
      this.byName.set(def.name, def);
      this.byTag.set(def.tag, def);
    }
  }

  get(name: string): ProtocolDef | undefined {
    return this.byName.get(name);
  }

  getByTag(tag: number): ProtocolDef | undefined {
    return this.byTag.get(tag);
  }

  encodeRequest(name: string, args: Record<string, unknown>, session: number): Uint8Array {
    const def = this.byName.get(name);
    if (!def?.req) throw new Error(`协议没有请求体: ${name}`);
    const header = this.sp.encode("package", { type: def.tag, session });
    const content = this.sp.encode(def.req, args);
    return sproto.pack(concat(header, content));
  }

  decodePackage(bytes: Uint8Array): DecodedPackage {
    const raw = sproto.unpack(bytes);
    const pkg = this.sp.decode("package", raw) as { type?: number; session?: number; ud?: Uint8Array };
    const headerLen = packageHeaderLength(raw);
    let body = raw.subarray(headerLen);
    if (body.byteLength === 0 && pkg.ud && pkg.ud.byteLength > 0) body = pkg.ud;
    return { type: pkg.type, session: pkg.session, body };
  }

  decodeStruct(typeName: string, bytes: Uint8Array): Record<string, unknown> {
    if (!bytes || bytes.byteLength === 0) return {};
    return this.sp.decode(typeName, bytes) as Record<string, unknown>;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/** .package 头的字节长度。格式：2 字节字段数 + 每字段 2 字节标记 + 非内联数据。 */
function packageHeaderLength(bytes: Uint8Array): number {
  if (bytes.byteLength < 2) throw new Error("sproto 头被截断");
  const u16 = (off: number) => bytes[off] | (bytes[off + 1] << 8);
  const u32 = (off: number) =>
    (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
  const count = u16(0);
  let field = 2;
  let data = 2 + count * 2;
  if (data > bytes.byteLength) throw new Error("sproto 字段被截断");
  for (let i = 0; i < count; i++) {
    const marker = u16(field);
    field += 2;
    if ((marker & 1) !== 0) continue;
    if (marker / 2 - 1 >= 0) continue;
    if (data + 4 > bytes.byteLength) throw new Error("sproto 长度被截断");
    const len = u32(data);
    data += 4 + len;
  }
  return data;
}
