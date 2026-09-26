import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-semibold text-brand-text">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Page not found</h1>
      <p className="mt-2 text-sm text-fg-muted">That tool doesn&apos;t exist.</p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover"
      >
        Back to all tools
      </Link>
    </div>
  );
}
