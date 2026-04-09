import { TFile } from "obsidian";
import { readVaultBinaryData } from "../EpubBinaryData";

const originalFetch = globalThis.fetch;

function createZipLikeArrayBuffer(length: number): ArrayBuffer {
	const bytes = new Uint8Array(length);
	bytes[0] = 0x50;
	bytes[1] = 0x4b;
	bytes[2] = 0x03;
	bytes[3] = 0x04;
	return bytes.buffer.slice(0);
}

function createMockFile(path: string, size: number) {
	return Object.assign(Object.create(TFile.prototype), {
		path,
		name: path.split("/").pop() || "book.epub",
		basename: "book",
		extension: "epub",
		parent: { path: "Books" },
		stat: {
			size,
			mtime: Date.now(),
			ctime: Date.now(),
		},
	}) as TFile;
}

afterEach(() => {
	vi.restoreAllMocks();
	if (typeof originalFetch === "function") {
		globalThis.fetch = originalFetch;
	} else {
		Reflect.deleteProperty(globalThis, "fetch");
	}
});

describe("readVaultBinaryData", () => {
	it("returns the primary vault.readBinary payload when its size matches the vault file stat", async () => {
		const exact = createZipLikeArrayBuffer(64);
		const file = createMockFile("Books/exact.epub", 64);
		const fetchSpy = vi.fn();
		(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

		const app = {
			vault: {
				readBinary: vi.fn(async () => exact),
				adapter: {
					readBinary: vi.fn(async () => createZipLikeArrayBuffer(32)),
				},
				getResourcePath: vi.fn(() => "app://resource/exact.epub"),
			},
		};

		const result = await readVaultBinaryData(app as any, file, file.path);

		expect(result.byteLength).toBe(64);
		expect(app.vault.readBinary).toHaveBeenCalledTimes(1);
		expect(app.vault.adapter.readBinary).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("falls back to fetching the resource path when native binary reads return a truncated EPUB", async () => {
		const truncated = createZipLikeArrayBuffer(40);
		const exact = createZipLikeArrayBuffer(96);
		const file = createMockFile("Books/mobile.epub", 96);
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			arrayBuffer: async () => exact,
		}));
		(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

		const app = {
			vault: {
				readBinary: vi.fn(async () => truncated),
				adapter: {
					readBinary: vi.fn(async () => truncated),
				},
				getResourcePath: vi.fn(() => "app://resource/mobile.epub"),
			},
		};

		const result = await readVaultBinaryData(app as any, file, file.path);

		expect(result.byteLength).toBe(96);
		expect(app.vault.readBinary).toHaveBeenCalledTimes(1);
		expect(app.vault.adapter.readBinary).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
