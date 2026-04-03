export function showNotification(
	message: string,
	type: "success" | "error" | "info" | "warning" = "info"
) {
	const n = document.createElement("div");
	n.className = `weave-notification notification-${type}`;

	const icon = document.createElement("span");
	icon.className = "weave-notification-icon";

	const iconMap = {
		success: "\u2713",
		error: "\u2715",
		warning: "\u26A0",
		info: "\u2139",
	};

	icon.textContent = iconMap[type] || iconMap.info;
	n.appendChild(icon);

	const textSpan = document.createElement("span");
	textSpan.textContent = message;
	textSpan.className = "weave-flex-1";
	n.appendChild(textSpan);

	document.body.appendChild(n);

	setTimeout(() => {
		n.classList.add("is-visible");
	}, 10);

	setTimeout(() => {
		n.classList.remove("is-visible");
		setTimeout(() => {
			if (n.parentNode) {
				n.remove();
			}
		}, 300);
	}, 3000);
}
