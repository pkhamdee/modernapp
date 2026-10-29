import { createBrowserRouter } from 'react-router'
import { RequireRole } from './auth/RequireRole.tsx'
import { AppLayout } from './layout/AppLayout.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { ApplicationPage } from './pages/ApplicationPage.tsx'
import { ApplyPage } from './pages/ApplyPage.tsx'
import { CatalogPage } from './pages/CatalogPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { ProductPage } from './pages/ProductPage.tsx'
import { SignInCodePage } from './pages/SignInCodePage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'

// One route tree for the whole app. Public Customer screens hang off AppLayout.
// Signed-in screens go in a nested layout route whose element checks the role:
// { element: <RequireRole role="Customer" />, children: [...] }. The back office is a separate
// /staff branch wrapped in <RequireRole role="Staff" /> (its sign-in page at /staff/sign-in stays
// outside the guard), so guards wrap whole sections, not single pages.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'categories/:code', element: <CatalogPage /> },
      { path: 'products/:id', element: <ProductPage /> },
      { path: 'sign-in', element: <SignInPage /> },
      { path: 'sign-in/code', element: <SignInCodePage /> },
      {
        element: <RequireRole role="Customer" />,
        children: [
          { path: 'account', element: <AccountPage /> },
          { path: 'products/:id/apply', element: <ApplyPage /> },
          { path: 'applications/:id', element: <ApplicationPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
