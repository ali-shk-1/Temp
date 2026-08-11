/**
 * components/AuthedPage.tsx
 *
 * Historically this ran its own auth guard + permissions fetch + NavBar
 * render on every page. That's now handled once, above all pages, by
 * app/(app)/layout.tsx -- see the comment there for why (it was the
 * cause of the white-flash/freeze on every tab switch).
 *
 * This component is kept only so every existing page's
 * `<AuthedPage activePage="...">...</AuthedPage>` wrapper keeps working
 * unchanged. It does nothing now but render its children.
 */

export default function AuthedPage({
  children,
}: {
  activePage?: string;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
