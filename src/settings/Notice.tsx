import { VisuallyHidden } from "@wordpress/components";

export function Notice({
  children,
  status,
  isDismissible = false,
}: {
  children: React.ReactNode;
  status: "info" | "success" | "error" | "warning";
  isDismissible?: boolean;
}) {
  return (
    <div className={`components-notice is-${status}`}>
      <VisuallyHidden>{`${status} notice`}</VisuallyHidden>
      <div className="components-notice__content">{children}</div>
      {isDismissible && (
        <button
          type="button"
          className="components-button components-notice__dismiss is-small has-icon"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m13.06 12 6.47-6.47-1.06-1.06L12 10.94 5.53 4.47 4.47 5.53 10.94 12l-6.47 6.47 1.06 1.06L12 13.06l6.47 6.47 1.06-1.06L13.06 12Z"></path>
          </svg>
        </button>
      )}
    </div>
  );
}
