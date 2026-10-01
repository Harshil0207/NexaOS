import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <p className="font-mono text-sm text-accent">404</p>
        <h1 className="mt-2 text-xl font-semibold">This page doesn’t exist</h1>
        <p className="mt-1 text-sm text-muted">
          It may have been moved, or you may not have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center rounded-lg border border-border-strong px-3.5 text-sm hover:bg-surface-2"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
