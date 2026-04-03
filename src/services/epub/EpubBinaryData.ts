import { logger } from "../../utils/logger";

type ByteArrayLike = ArrayLike<number> & { [index: number]: number };
type BufferLike = {
	buffer: ArrayBuffer;
	byteOffset?: number;
	byteLength?: number;
};

function describeBinarySource(value: unknown): string {
	if (value == null) {
		return String(value);
	}

	const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
	return constructorName || typeof value;
}

function getBinaryLength(value: unknown): number | null {
	if (value instanceof ArrayBuffer) {
		return value.byteLength;
	}

	if (ArrayBuffer.isView(value)) {
		return value.byteLength;
	}

	if (Array.isArray(value)) {
		return value.length;
	}

	if (typeof value === "object" && value !== null && "byteLength" in value) {
		const byteLength = Number((value as { byteLength?: unknown }).byteLength);
		return Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : null;
	}

	if (typeof value === "object" && value !== null && "length" in value) {
		const length = Number((value as { length?: unknown }).length);
		return Number.isFinite(length) && length >= 0 ? length : null;
	}

	return null;
}

function isBufferLike(value: unknown): value is BufferLike {
	if (!value || typeof value !== "object" || !("buffer" in value)) {
		return false;
	}

	const buffer = (value as { buffer?: unknown }).buffer;
	return buffer instanceof ArrayBuffer;
}

function isByteArrayLike(value: unknown): value is ByteArrayLike {
	if (!value || typeof value !== "object" || !("length" in value)) {
		return false;
	}

	const length = Number((value as { length?: unknown }).length);
	return Number.isInteger(length) && length >= 0;
}

function buildSignatureHex(bytes: Uint8Array): string {
	return Array.from(bytes.slice(0, 4))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join(" ");
}

export function hasZipSignature(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

export function normalizeVaultBinaryData(
	binary: unknown,
	context: string
): Uint8Array<ArrayBuffer> {
	let normalized: Uint8Array<ArrayBuffer>;

	if (binary instanceof Uint8Array) {
		normalized = Uint8Array.from(binary);
	} else if (binary instanceof ArrayBuffer) {
		normalized = new Uint8Array(binary.slice(0));
	} else if (ArrayBuffer.isView(binary)) {
		normalized = Uint8Array.from(
			new Uint8Array(binary.buffer as ArrayBuffer, binary.byteOffset, binary.byteLength)
		);
	} else if (Array.isArray(binary)) {
		normalized = Uint8Array.from(binary);
	} else if (isBufferLike(binary)) {
		normalized = Uint8Array.from(
			new Uint8Array(
				binary.buffer,
				binary.byteOffset ?? 0,
				binary.byteLength ?? binary.buffer.byteLength
			)
		);
	} else if (isByteArrayLike(binary)) {
		const result = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			result[index] = Number(binary[index] ?? 0);
		}
		normalized = result;
	} else {
		throw new Error(`EPUB 二进制格式不受支持: ${context} (${describeBinarySource(binary)})`);
	}

	const diagnostics = {
		context,
		sourceType: describeBinarySource(binary),
		sourceLength: getBinaryLength(binary),
		normalizedLength: normalized.byteLength,
		signature: buildSignatureHex(normalized),
	};

	logger.debugWithTag("EpubBinaryData", "Normalized vault binary payload", diagnostics);

	if (!hasZipSignature(normalized)) {
		logger.warn("[EpubBinaryData] EPUB payload is missing ZIP signature", diagnostics);
	}

	return normalized;
}
