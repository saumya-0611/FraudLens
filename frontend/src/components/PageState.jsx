import { useEffect, useRef } from "react";

export function Loading({ label = "Loading…" }) {
    return <div className="panel state" role="status">{label}</div>;
}

export function ErrorState({ message, onRetry }) {
    return (
        <div className="panel state error-state" role="alert">
            <p>{message}</p>
            {onRetry && <button className="button" onClick={onRetry}>Retry</button>}
        </div>
    );
}

export function Empty({ children = "No records found." }) {
    return <div className="panel state">{children}</div>;
}

export function RiskBadge({ value }) {
    const tone = value === "HIGH_RISK" ? "high"
        : value === "SUSPICIOUS" ? "medium"
            : value === "LEGITIMATE" ? "low" : "pending";
    const label = value === "HIGH_RISK" ? "HIGH RISK"
        : value === "PENDING" ? "UNSCORED" : value || "—";
    return <span className={`badge ${tone}`}>{label}</span>;
}

export function StateBadge({ value }) {
    return (
        <span className={`badge state-${String(value || "").toLowerCase()}`}>
            {String(value || "—").replaceAll("_", " ")}
        </span>
    );
}

export function Modal({ title, onClose, children }) {
    const dialogRef = useRef(null);
    const closeRef = useRef(onClose);

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const dialog = dialogRef.current;
        const previousFocus = document.activeElement;
        const focusableSelector = [
            "a[href]", "button:not([disabled])", "input:not([disabled])",
            "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
        ].join(",");

        const focusable = () => [...dialog.querySelectorAll(focusableSelector)];
        (focusable()[0] || dialog).focus();

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== "Tab") return;

            const items = focusable();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, []);

    return (
        <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={event => event.target === event.currentTarget && onClose()}
        >
            <section
                ref={dialogRef}
                className="modal panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                tabIndex={-1}
            >
                <div className="modal-title">
                    <h2 id="modal-title">{title}</h2>
                    <button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button>
                </div>
                {children}
            </section>
        </div>
    );
}
