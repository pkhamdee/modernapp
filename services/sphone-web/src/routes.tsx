import { createBrowserRouter } from 'react-router'
import { AppLayout } from './layout/AppLayout.tsx'
import { CatalogPage } from './pages/CatalogPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { ProductPage } from './pages/ProductPage.tsx'

// One route tree for the whole app. Public Customer screens hang off AppLayout.
// Signed-in screens are added as a nested layout route whose element checks the role,
// e.g. { element: <RequireRole role="Customer" />, children: [...] } and a separate
// /staff branch for the back office, so guards wrap whole sections, not single pages.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'categories/:code', element: <CatalogPage /> },
      { path: 'products/:id', element: <ProductPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
