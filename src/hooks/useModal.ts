import { logger } from "../utils/logger";

export interface ModalState<TData = unknown> {
	readonly isOpen: boolean;
	readonly isOpening: boolean;
	readonly isClosing: boolean;
	readonly data?: TData;
}

interface InternalModalState<TData = unknown> {
	isOpen: boolean;
	isOpening: boolean;
	isClosing: boolean;
	data?: TData;
}

export interface ModalActions<TData = unknown> {
	open: (data?: TData) => void;
	close: () => void;
	toggle: () => void;
	reset: () => void;
}

export interface ModalOptions<TData = unknown> {
	preventDuplicateOpen?: boolean;
	closeOnEscape?: boolean;
	closeOnClickOutside?: boolean;
	destroyOnClose?: boolean;
	onOpen?: (data?: TData) => void;
	onClose?: () => void;
	onError?: (error: Error) => void;
}

export interface UseModalReturn<TData = unknown> extends ModalState<TData>, ModalActions<TData> {
	handleKeydown: (event: KeyboardEvent) => void;
	handleClickOutside: (event: MouseEvent, modalRef: HTMLElement | null) => void;
}

interface ConfirmModalData {
	type: "confirm";
	title: string;
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
}

interface FormModalData<T extends Record<string, unknown>> {
	type: "form";
	initialData?: Partial<T>;
	formData: Partial<T>;
}

interface LoadingModalData {
	type: "loading";
	message: string;
}

export function useModal<TData = unknown>(
	options: ModalOptions<TData> = {}
): UseModalReturn<TData> {
	const {
		preventDuplicateOpen = true,
		closeOnClickOutside = true,
		destroyOnClose = false,
		onOpen,
		onClose,
		onError,
	} = options;

	const state: InternalModalState<TData> = {
		isOpen: false,
		isOpening: false,
		isClosing: false,
		data: undefined,
	};

	const open = (modalData?: TData) => {
		try {
			if (preventDuplicateOpen && (state.isOpen || state.isOpening)) {
				logger.warn("Modal is already open or opening", {
					isOpen: state.isOpen,
					isOpening: state.isOpening,
					currentData: state.data,
				});
				return;
			}

			state.isOpening = true;
			state.data = modalData;

			queueMicrotask(() => {
				state.isOpen = true;
				state.isOpening = false;
				onOpen?.(modalData);
				logger.debug("Modal opened successfully", { data: modalData });
			});
		} catch (error) {
			state.isOpening = false;
			const errorObj = error instanceof Error ? error : new Error(String(error));
			logger.error("[useModal] open failed:", errorObj);
			onError?.(errorObj);
		}
	};

	const close = () => {
		try {
			if (!state.isOpen || state.isClosing) {
				return;
			}

			state.isClosing = true;

			queueMicrotask(() => {
				state.isOpen = false;
				state.isClosing = false;

				if (destroyOnClose) {
					state.data = undefined;
				}

				onClose?.();
				logger.debug("Modal closed successfully");
			});
		} catch (error) {
			state.isClosing = false;
			const errorObj = error instanceof Error ? error : new Error(String(error));
			logger.error("[useModal] close failed:", errorObj);
			onError?.(errorObj);
		}
	};

	const toggle = () => {
		if (state.isOpen) {
			close();
			return;
		}

		open();
	};

	const reset = () => {
		state.isOpen = false;
		state.isOpening = false;
		state.isClosing = false;
		state.data = undefined;
	};

	const handleKeydown = (_event: KeyboardEvent) => {
		// Escape is handled by Obsidian to avoid shortcut conflicts.
	};

	const handleClickOutside = (event: MouseEvent, modalRef: HTMLElement | null) => {
		if (!closeOnClickOutside || !state.isOpen || !modalRef) {
			return;
		}

		const target = event.target as Node;
		if (!modalRef.contains(target)) {
			close();
		}
	};

	return {
		get isOpen() {
			return state.isOpen;
		},
		get isOpening() {
			return state.isOpening;
		},
		get isClosing() {
			return state.isClosing;
		},
		get data() {
			return state.data;
		},
		open,
		close,
		toggle,
		reset,
		handleKeydown,
		handleClickOutside,
	};
}

export function useConfirmModal() {
	const modal = useModal<ConfirmModalData>({
		preventDuplicateOpen: true,
		closeOnEscape: true,
		closeOnClickOutside: false,
	});

	const requestConfirmation = (message: string, title?: string): Promise<boolean> => {
		return new Promise((resolve) => {
			modal.open({
				type: "confirm",
				title: title || "确认",
				message,
				onConfirm: () => {
					modal.close();
					resolve(true);
				},
				onCancel: () => {
					modal.close();
					resolve(false);
				},
			});
		});
	};

	return Object.assign(modal, {
		requestConfirmation,
	});
}

export function useFormModal<T extends Record<string, unknown> = Record<string, unknown>>(
	options: ModalOptions<FormModalData<T>> = {}
) {
	const modal = useModal<FormModalData<T>>({
		...options,
		destroyOnClose: true,
	});

	const openForm = (initialData?: Partial<T>) => {
		const formData: Partial<T> = initialData ? { ...initialData } : {};

		modal.open({
			type: "form",
			initialData,
			formData,
		});
	};

	const updateFormData = (updates: Partial<T>) => {
		if (modal.data) {
			modal.data.formData = { ...modal.data.formData, ...updates };
		}
	};

	const getFormData = (): Partial<T> | undefined => {
		return modal.data?.formData;
	};

	return Object.assign(modal, {
		openForm,
		updateFormData,
		getFormData,
	});
}

export function useLoadingModal() {
	const modal = useModal<LoadingModalData>({
		preventDuplicateOpen: true,
		closeOnEscape: false,
		closeOnClickOutside: false,
	});

	const showLoading = (message?: string) => {
		modal.open({
			type: "loading",
			message: message || "加载中...",
		});
	};

	const hideLoading = () => {
		modal.close();
	};

	const withLoading = async <T>(promise: Promise<T>, message?: string): Promise<T> => {
		showLoading(message);
		try {
			const result = await promise;
			hideLoading();
			return result;
		} catch (error) {
			hideLoading();
			throw error;
		}
	};

	return Object.assign(modal, {
		showLoading,
		hideLoading,
		withLoading,
	});
}

class GlobalModalManager {
	private activeModals = new Set<string>();
	private modalStack: string[] = [];

	register(modalId: string) {
		this.activeModals.add(modalId);
		this.modalStack.push(modalId);
	}

	unregister(modalId: string) {
		this.activeModals.delete(modalId);
		const index = this.modalStack.indexOf(modalId);
		if (index > -1) {
			this.modalStack.splice(index, 1);
		}
	}

	closeAll() {
		this.activeModals.clear();
		this.modalStack = [];
	}

	getActiveModals() {
		return Array.from(this.activeModals);
	}

	getModalStack() {
		return [...this.modalStack];
	}
}

export const globalModalManager = new GlobalModalManager();

export const showConfirm = (message: string, title?: string): Promise<boolean> => {
	const { requestConfirmation } = useConfirmModal();
	return requestConfirmation(message, title);
};

export const withLoading = async <T>(promise: Promise<T>, message?: string): Promise<T> => {
	const modal = useLoadingModal();
	return modal.withLoading(promise, message);
};
